import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Download, Locator, Page } from "playwright";
import sharp from "sharp";
import { buildFlowProductPhotoPrompt } from "../ai/gemini-images";

export type FlowRunTiming = {
  startedAt: string;
  durationMs: number;
  uploadMs: number;
  generationMs: number;
};

export const FLOW_IMAGE_MODELS = ["Nano Banana Pro", "Nano Banana 2", "Nano Banana 2 Lite"] as const;
export type FlowImageModel = (typeof FLOW_IMAGE_MODELS)[number];
export const FLOW_IMAGE_ASPECT_RATIOS = ["16:9", "4:3", "1:1", "3:4", "9:16"] as const;
export type FlowImageAspectRatio = (typeof FLOW_IMAGE_ASPECT_RATIOS)[number];

export function inferFlowImageAspectRatio(width: number, height: number): FlowImageAspectRatio {
  if (!(width > 0) || !(height > 0)) return "1:1";
  const ratio = width / height;
  const presets: Array<[FlowImageAspectRatio, number]> = [
    ["16:9", 16 / 9],
    ["4:3", 4 / 3],
    ["1:1", 1],
    ["3:4", 3 / 4],
    ["9:16", 9 / 16],
  ];
  return presets.reduce((best, current) => (
    Math.abs(Math.log(ratio / current[1])) < Math.abs(Math.log(ratio / best[1])) ? current : best
  ))[0];
}

export class FlowModelLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FlowModelLimitError";
  }
}

function isFlowRoute(url: string) {
  try {
    return /^\/fx\/(?:[a-z]{2}\/)?tools\/flow(?:\/|$)/i.test(new URL(url).pathname);
  } catch {
    return false;
  }
}

export function isFlowAccessGateUrl(url: string) {
  try {
    const parsed = new URL(url);
    return parsed.hostname === "labs.google" && parsed.pathname === "/";
  } catch {
    return false;
  }
}

export async function isFlowMarketingLandingPage(page: Page) {
  if (await page.locator('input[type="file"], [data-testid="prompt"]').count()) return false;
  return Boolean(await firstVisible(page, [
    'button:has-text("Try in Google Flow")',
    'button:has-text("Create with Google Flow")',
    'button:has-text("Try Google Flow")',
  ]));
}

export async function generateFlowImage(input: {
  page: Page;
  flowUrl: string;
  references: string[];
  prompt: string;
  outputPath: string;
  timeoutMs: number;
  maxOutputEdge?: 2048 | 4096;
  downloadResolution?: "2K";
  model?: FlowImageModel;
  aspectRatio?: FlowImageAspectRatio;
}): Promise<FlowRunTiming> {
  const started = Date.now();
  const startedAt = new Date(started).toISOString();
  if (input.page.url() !== input.flowUrl) {
    await input.page.goto(input.flowUrl, { waitUntil: "domcontentloaded", timeout: 45_000 });
  }
  if (await input.page.getByText("Flow is not available in your country yet.").isVisible().catch(() => false)) {
    throw new Error("Google Flow недоступен из текущего региона. Включите VPN в профиле локального агента.");
  }

  await clickFirstVisible(input.page, [
    'button:has-text("Hide")',
  ], false);
  const handledConsent = await clickFirstVisible(input.page, [
    'button:has-text("Agree")',
    'a[role="button"]:has-text("Agree")',
    'button:has-text("Принять")',
    'a[role="button"]:has-text("Принять")',
    'button:has-text("No thanks")',
    'a[role="button"]:has-text("No thanks")',
    'button:has-text("Нет, спасибо")',
  ], false);
  if (handledConsent) {
    await input.page.waitForTimeout(1_000);
    if (!isFlowRoute(input.page.url())) {
      await input.page.goto(input.flowUrl, { waitUntil: "domcontentloaded", timeout: 45_000 });
    }
  }
  const openedFlow = await openFlowExperience(input.page, [
    'button:has-text("Create with Google Flow")',
    'button:has-text("Create with Flow")',
  ]);
  if (openedFlow) await input.page.waitForTimeout(2_000);
  await openProjectWorkspace(input.page, input.flowUrl, 90_000);
  if (input.model) await selectFlowImageModel(input.page, input.model, input.aspectRatio);

  const fileInput = await waitForFileInput(input.page);
  let uploadError: unknown;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      if (attempt > 1) await fileInput.setInputFiles([]);
      await fileInput.setInputFiles(input.references);
      await acceptRightsNotice(input.page);
      await attachUploadedReferences(input.page, input.references);
      uploadError = undefined;
      break;
    } catch (error) {
      uploadError = await describeFlowPageError(input.page, error);
      await input.page.keyboard.press("Escape").catch(() => undefined);
      await input.page.waitForTimeout(1_500);
    }
  }
  if (uploadError) throw uploadError;
  const uploadFinished = Date.now();

  const promptInput = await firstVisible(input.page, [
    '[data-testid="prompt"]',
    'textarea[placeholder*="prompt" i]',
    'textarea',
    '[role="textbox"]',
    '[contenteditable="true"][role="textbox"]',
  ]);
  if (!promptInput) throw new Error("Flow: не найдено поле промпта.");
  await enterFlowPrompt(input.page, promptInput, compactFlowPrompt(input.prompt));

  const generateButton = await waitForFirstEnabled(input.page, [
    '[data-testid="generate"]',
    'button:has-text("arrow_forward")',
    'button:has-text("Generate")',
    'button[aria-label*="Generate" i]',
    'button:has-text("Create")',
  ], 90_000);
  if (!generateButton) throw new Error("Flow: не найдена кнопка генерации.");
  const existingSources = new Set(await input.page.locator("img").evaluateAll(
    (images) => images.map((image) => (image as HTMLImageElement).src).filter(Boolean),
  ));
  await generateButton.click();

  const result = await waitForResult(input.page, input.timeoutMs, existingSources);
  const generatedAt = Date.now();
  await mkdir(path.dirname(input.outputPath), { recursive: true });
  const source = await result.getAttribute("src");
  let downloaded = await downloadWithFlowButton(input.page, result, input.outputPath, input.downloadResolution);
  if (!downloaded && source?.startsWith("data:")) {
    await writeFile(input.outputPath, Buffer.from(source.split(",", 2)[1], "base64"));
    downloaded = true;
  } else if (!downloaded && source) {
    const absoluteSource = source.startsWith("blob:") ? source : new URL(source, input.page.url()).toString();
    try {
      await writeFile(input.outputPath, await downloadResultInsideBrowser(input.page, absoluteSource));
      downloaded = true;
    } catch {
      if (!source.startsWith("blob:")) {
        try {
          await writeFile(input.outputPath, await downloadResultImage(input.page, absoluteSource));
          downloaded = true;
        } catch {
          // Try Flow's own download button below.
        }
      }
    }
    if (!downloaded) await captureRenderedResult(result, input.outputPath, input.maxOutputEdge || 2048);
  } else if (!downloaded) {
    throw new Error("Flow: у результата нет доступного изображения или кнопки скачивания.");
  }
  if (input.downloadResolution) await ensureFlow2K(input.outputPath);
  const finished = Date.now();
  return {
    startedAt,
    durationMs: finished - started,
    uploadMs: uploadFinished - started,
    generationMs: generatedAt - uploadFinished,
  };
}

async function downloadWithFlowButton(page: Page, result: Locator, outputPath: string, resolution?: "2K") {
  try {
    const selectors = [
      '[data-testid="result-download"]',
      'button[aria-label*="Download" i]',
      'button[aria-label*="Скачать" i]',
      'button:has-text("Download")',
      'button:has-text("Скачать")',
    ];
    let downloadButton = await firstVisible(page, selectors);
    if (!downloadButton && resolution) {
      await result.click();
      downloadButton = await waitForFirstVisible(page, selectors, 15_000);
    }
    if (!downloadButton) {
      if (resolution) throw new Error("Flow: не найдена кнопка скачивания результата в 2K.");
      return false;
    }
    const directDownloadPromise = page.waitForEvent("download", { timeout: 3_000 }).catch(() => undefined);
    await downloadButton.click();
    let download: Download | undefined;
    if (resolution) {
      const resolutionItem = await waitForFirstEnabled(page, [
        '[role="menuitem"]:has-text("2K")',
        'button[role="menuitem"]:has-text("2K")',
        'button:has-text("2K"):has-text("Upscaled")',
        'button:has-text("2K"):has-text("Увеличенное разрешение")',
      ], 1_500) || await waitForFirstEnabled(page, [
        '[role="menuitem"]:has-text("1K")',
        '[role="menuitem"]:has-text("Original")',
      ], 1_500);
      if (resolutionItem) {
        const optionDownloadPromise = page.waitForEvent("download", { timeout: 30_000 });
        await resolutionItem.click();
        download = await optionDownloadPromise;
      }
    }
    download ||= await directDownloadPromise;
    if (!download) throw new Error("Flow: download did not start.");
    const temporaryPath = `${outputPath}.${Date.now()}.flow-download`;
    try {
      await download.saveAs(temporaryPath);
      await rm(outputPath, { force: true });
      await rename(temporaryPath, outputPath);
    } catch {
      await rm(temporaryPath, { force: true }).catch(() => undefined);
      // Flow can invalidate Playwright's temporary artifact while the signed
      // result image is still available, and Windows can reject replacing an
      // existing retry candidate. Let the caller save the visible result source
      // instead of spending credits on another generation.
      return false;
    }
    return true;
  } catch (error) {
    if (resolution) throw error;
    return false;
  }
}

async function assertFlow2K(outputPath: string) {
  const metadata = await sharp(outputPath).metadata();
  const longestEdge = Math.max(metadata.width || 0, metadata.height || 0);
  if (longestEdge < 2048) {
    throw new Error(`Flow: вместо 2K скачано изображение ${metadata.width || 0}x${metadata.height || 0}.`);
  }
}

async function ensureFlow2K(outputPath: string) {
  const metadata = await sharp(outputPath).metadata();
  const longestEdge = Math.max(metadata.width || 0, metadata.height || 0);
  if (longestEdge > 0 && longestEdge < 2048) {
    const temporaryPath = `${outputPath}.${Date.now()}.2k-normalized`;
    const normalized = await sharp(outputPath)
      .rotate()
      .resize({
        width: 2048,
        height: 2048,
        fit: "inside",
        kernel: sharp.kernel.lanczos3,
      })
      .sharpen({ sigma: 0.55, m1: 0.8, m2: 1.8 })
      .png({ compressionLevel: 8, adaptiveFiltering: true })
      .toBuffer();
    try {
      await writeFile(temporaryPath, normalized);
      await rm(outputPath, { force: true });
      await rename(temporaryPath, outputPath);
    } catch (error) {
      await rm(temporaryPath, { force: true }).catch(() => undefined);
      throw error;
    }
  }
  await assertFlow2K(outputPath);
}

async function downloadResultImage(page: Page, sourceUrl: string) {
  try {
    return await downloadResultInsideBrowser(page, sourceUrl);
  } catch {
    // Fall back to resolving the signed CDN URL outside the page.
  }

  let downloadUrl = sourceUrl;
  const redirect = await page.request.get(sourceUrl, {
    maxRedirects: 0,
    timeout: 45_000,
  });
  try {
    if (redirect.status() >= 300 && redirect.status() < 400) {
      const location = redirect.headers().location;
      if (!location) throw new Error("Flow: Google не вернул ссылку на готовое изображение.");
      downloadUrl = new URL(location, sourceUrl).toString();
    } else {
      if (!redirect.ok()) throw new Error(`Flow: результат не скачан, HTTP ${redirect.status()}.`);
      return Buffer.from(await redirect.body());
    }
  } finally {
    await redirect.dispose();
  }

  let lastError: unknown;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(downloadUrl, {
        headers: { accept: "image/*" },
        signal: AbortSignal.timeout(20_000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const result = Buffer.from(await response.arrayBuffer());
      if (!result.length) throw new Error("empty response");
      return result;
    } catch (error) {
      lastError = error;
      if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, attempt * 1_500));
    }
  }
  throw new Error(`Flow: готовое изображение не скачано после трёх попыток. ${
    lastError instanceof Error ? lastError.message : String(lastError)
  }`);
}

async function downloadResultInsideBrowser(page: Page, sourceUrl: string) {
  const base64 = await page.evaluate(async (url) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20_000);
    try {
      const response = await fetch(url, {
        cache: "force-cache",
        credentials: "include",
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const bytes = new Uint8Array(await response.arrayBuffer());
      let binary = "";
      for (let offset = 0; offset < bytes.length; offset += 32_768) {
        binary += String.fromCharCode(...bytes.subarray(offset, offset + 32_768));
      }
      return btoa(binary);
    } finally {
      clearTimeout(timeout);
    }
  }, sourceUrl);
  const result = Buffer.from(base64, "base64");
  if (!result.length) throw new Error("Flow: браузер вернул пустое изображение.");
  return result;
}

async function captureRenderedResult(result: Locator, outputPath: string, maxOutputEdge: 2048 | 4096) {
  const marker = `flow-agent-capture-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  await result.evaluate((image, input) => {
    const source = image as HTMLImageElement;
    const naturalWidth = source.naturalWidth || source.width || 1024;
    const naturalHeight = source.naturalHeight || source.height || naturalWidth;
    const scale = Math.min(1, input.maxOutputEdge / Math.max(naturalWidth, naturalHeight));
    const width = Math.max(1, Math.round(naturalWidth * scale));
    const height = Math.max(1, Math.round(naturalHeight * scale));
    const clone = source.cloneNode(true) as HTMLImageElement;
    clone.id = input.id;
    clone.style.cssText = [
      "position:fixed",
      "left:0",
      "top:0",
      "z-index:2147483647",
      `width:${width}px`,
      `height:${height}px`,
      "max-width:none",
      "max-height:none",
      "object-fit:fill",
      "background:white",
    ].join(";");
    document.body.appendChild(clone);
  }, { id: marker, maxOutputEdge });
  const capture = result.page().locator(`#${marker}`);
  try {
    await capture.screenshot({
      path: outputPath,
      type: "png",
      animations: "disabled",
      timeout: 30_000,
    });
  } finally {
    await capture.evaluate((image) => image.remove()).catch(() => undefined);
  }
}

async function acceptRightsNotice(page: Page) {
  const notice = await waitForFirstVisible(page, [
    'button:has-text("I accept")',
    'button:has-text("Accept")',
    'button:has-text("Принимаю")',
  ], 5_000);
  if (!notice) return;
  await notice.click({ timeout: 5_000 }).catch(async (error) => {
    if (await firstVisible(page, ['[role="dialog"]'])) throw error;
  });
}

async function attachUploadedReferences(page: Page, references: string[]) {
  for (const reference of references) {
    const addMedia = await waitForFirstVisible(page, [
      '[data-testid="add-media"]',
      'button:has-text("add_2")',
    ], 30_000);
    if (!addMedia) throw new Error("Flow: не найдена кнопка прикрепления референсов.");
    await addMedia.click();

    const fileName = path.basename(reference);
    const image = page.locator(`[role="dialog"] img[alt=${JSON.stringify(fileName)}]`).last();
    await image.waitFor({ state: "visible", timeout: 60_000 });
    await image.click();

    const attachSelectors = [
      'button:has-text("Add to prompt")',
      'button:has-text("Add to request")',
      'button:has-text("Добавить в запрос")',
    ];
    let attached = false;
    let attachError: unknown;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const attach = await waitForFirstEnabled(page, attachSelectors, 20_000);
      if (!attach) break;
      try {
        await attach.click({ timeout: 10_000 });
        attached = true;
        break;
      } catch (error) {
        attachError = error;
        await page.waitForTimeout(500);
      }
    }
    if (!attached) {
      throw attachError instanceof Error
        ? attachError
        : new Error("Flow: загруженный референс не удалось добавить в запрос.");
    }
    await page.locator('[role="dialog"]').waitFor({ state: "hidden", timeout: 20_000 });
  }
}

async function selectFlowImageModel(page: Page, model: FlowImageModel, aspectRatio?: FlowImageAspectRatio) {
  let modelButton = await firstVisible(page, [
    'button[aria-haspopup="menu"]:has-text("Nano Banana")',
  ]);
  if (!modelButton) {
    const settingsButton = await waitForFirstVisible(page, [
      'button:has-text("tune"):has-text("Настройки")',
      'button:has-text("tune"):has-text("Settings")',
    ], 15_000);
    if (!settingsButton) throw new Error("Flow: не найдены настройки модели изображения.");
    await settingsButton.click({ timeout: 10_000 });
    modelButton = await waitForFirstVisible(page, [
      'button[aria-haspopup="menu"]:has-text("Nano Banana")',
    ], 15_000);
  }
  if (!modelButton) throw new Error("Flow: не найден выбор модели Nano Banana.");

  if (aspectRatio) {
    const ratioTab = page.locator('[role="tab"]:visible').filter({ hasText: aspectRatio }).first();
    if (!await ratioTab.isVisible().catch(() => false)) {
      throw new Error(`Flow: image aspect ratio ${aspectRatio} is not available.`);
    }
    if (await ratioTab.getAttribute("aria-selected") !== "true") await ratioTab.click({ timeout: 10_000 });
  }

  const selectedText = (await modelButton.innerText()).replace(/\s+/g, " ").trim();
  if (!selectedText.includes(model)) {
    await modelButton.click({ timeout: 10_000 });
    const modelItem = await waitForFirstEnabled(page, [
      `[role="menuitem"]:has-text("${model}")`,
    ], 10_000);
    if (!modelItem) throw new FlowModelLimitError(`Flow: модель ${model} недоступна; переключаюсь на следующую.`);
    await modelItem.click({ timeout: 10_000 });
  }

  const saveButton = await waitForFirstEnabled(page, [
    'button:has-text("Сохранить")',
    'button:has-text("Save")',
  ], 10_000);
  if (saveButton) await saveButton.click({ timeout: 10_000 });
}

async function enterFlowPrompt(page: Page, promptInput: Locator, prompt: string) {
  await promptInput.click();
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.insertText(prompt);

  const inserted = await promptInput.evaluate((node) => {
    if (node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement) return node.value;
    return node.textContent || "";
  });
  if (!inserted.includes(prompt.slice(0, Math.min(prompt.length, 80)))) await promptInput.fill(prompt);
}

export function compactFlowPrompt(prompt: string) {
  const maxLength = 1_400;
  const normalized = prompt.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  if (normalized.includes("immutable product identity") && normalized.includes("REFERENCE IMAGE 1")) {
    return buildFlowProductPhotoPrompt();
  }
  const preservesExistingProduct = normalized.includes("IMAGE 1 = ONLY immutable product")
    || normalized.includes("Preserve IMAGE 1 exactly");
  if (preservesExistingProduct) {
    const prefix = normalized.slice(0, maxLength);
    const boundary = Math.max(prefix.lastIndexOf(". "), prefix.lastIndexOf("; "));
    return boundary > maxLength - 160 ? prefix.slice(0, boundary + 1) : prefix;
  }
  const customAnchorSide = normalized.includes("FRONT DESIGN ANCHOR")
    ? "FRONT"
    : normalized.includes("BACK DESIGN ANCHOR") ? "BACK" : null;
  if (customAnchorSide && !normalized.includes("NIGHT VEIL") && normalized.includes("PRODUCTION LOCK:")) {
    const otherSide = customAnchorSide === "FRONT" ? "BACK:" : "PRODUCTION LOCK:";
    const sideStart = normalized.indexOf(`${customAnchorSide}:`);
    const sideEnd = sideStart >= 0 ? normalized.indexOf(` ${otherSide}`, sideStart + customAnchorSide.length + 1) : -1;
    const productionStart = normalized.indexOf("PRODUCTION LOCK:");
    const productionEnd = productionStart >= 0 ? normalized.indexOf(" NO ", productionStart) : -1;
    const banStart = productionEnd >= 0 ? productionEnd + 1 : -1;
    const banEnd = banStart >= 0 ? normalized.indexOf(" Preserve the exact", banStart) : -1;
    const title = normalized.match(/MARKET-GROUNDED ORIGINAL DESIGN[^.]*\./i)?.[0] || "ORIGINAL MARKET-GROUNDED DESIGN.";
    const sceneLock = normalized.slice(0, normalized.indexOf(`${customAnchorSide} DESIGN ANCHOR`)).split(". ")[0];
    const sideBrief = sideStart >= 0
      ? normalized.slice(sideStart, sideEnd > sideStart ? sideEnd : Math.min(normalized.length, sideStart + 520))
      : "";
    const production = productionStart >= 0
      ? normalized.slice(productionStart, productionEnd > productionStart ? productionEnd : Math.min(normalized.length, productionStart + 320))
      : "";
    const bans = banStart >= 0
      ? normalized.slice(banStart, banEnd > banStart ? banEnd : Math.min(normalized.length, banStart + 320))
      : "";
    const preserveWinnerLabel = normalized.includes("WINNER LABEL LOCK");
    const suffix = customAnchorSide === "FRONT"
      ? preserveWinnerLabel
        ? "FRONT only. Render that exact front subject. Preserve the proven garment's exact internal neck marking on the visible inside back-neck panel; never place it on the exterior chest and never add a hang tag or fastener. The attached scene reference is the ONLY allowed background; copy its exact surface, seams, folds, crop and light. No Avito, Grailed or any watermark. Photorealistic product photo."
        : "FRONT only. Render that exact front subject, not generic gothic art. Keep one printable torso placement with black negative space. Clean collar: no visible label text, hang tag, paper tag, woven tab, white locator, fastener, string or tag fragment. The attached scene reference is the ONLY allowed background; copy it exactly. No Avito, Grailed or any watermark. Photorealistic product photo."
      : "BACK only. Render that exact back subject, distinct from the front principal subject, not generic gothic art. Keep one printable torso placement with black negative space. No visible label text, hang tag, paper tag, woven tab, white locator, fastener, string or tag fragment. Last reference is SCENE ONLY and must be copied exactly. No Avito, Grailed or any watermark. Photorealistic product photo.";
    return [sceneLock, `${customAnchorSide} DESIGN ANCHOR.`, title, sideBrief, production, bans, suffix]
      .filter(Boolean)
      .join(" ")
      .slice(0, maxLength);
  }
  const preserveWinnerLabel = normalized.includes("WINNER LABEL LOCK");
  const stageSuffix = normalized.includes("FINAL FRONT PRINT DETAIL")
    ? preserveWinnerLabel
      ? " Preserve every pixel and edge of the approved front artwork and the exact internal winner neck marking. Create a NEW real-camera oblique close product photo with the inside back-neck panel visible; never add an exterior label, hang tag or fastener."
      : " Preserve every pixel and edge of the approved front artwork. Create a NEW real-camera oblique close product photo, never a digital crop. Keep the complete print at 35-50% of frame plus visible collar, one complete sleeve, a garment edge and surrounding scene background. No label text, hang tag, white locator, fastener, string or tag fragment."
    : normalized.includes("FINAL FRONT PHOTO")
    ? preserveWinnerLabel
      ? " Preserve IMAGE 1 artwork, product geometry and exact internal winner neck marking. Keep the marking only on the visible inside back-neck panel; no exterior label, hang tag or fastener. Return one sharp photorealistic FRONT photo."
      : " Preserve IMAGE 1 artwork and product geometry exactly; never redesign it. Keep the upper external chest and collar free of label text. No hang tag, paper tag, woven tab, white locator, fastener, string or tag fragment. The internal heat-transfer marking stays hidden. Return one sharp photorealistic FRONT photo."
    : normalized.includes("FINAL BACK PHOTO")
      ? " Preserve IMAGE 1 artwork and product geometry exactly; never redesign it. Show the BACK only. No visible label text, hang tag, paper tag, woven tab, white locator, fastener, string or tag fragment; the internal heat-transfer marking stays hidden. Return one sharp photorealistic BACK photo."
      : normalized.includes("FRONT DESIGN ANCHOR")
        ? normalized.includes("NIGHT VEIL")
          ? " Follow the approved FRONT artwork literally. Keep it printable within 24 x 32 cm with black negative space; no rectangular field, all-over print or random stock addition. Never suppress an approved bone, skull, web or cross merely because of its subject. Return one sharp photorealistic FRONT photo."
          : " Follow the approved FRONT artwork literally. Keep it printable within 24 x 32 cm with black negative space; no rectangular field or all-over print. Never substitute an unrelated skull, bone, cross, web, animal, mascot or stock gothic graphic. Return one sharp photorealistic FRONT photo."
        : normalized.includes("BACK DESIGN ANCHOR")
          ? normalized.includes("NIGHT VEIL")
            ? " Follow the approved BACK artwork literally and keep it distinct from the front. Keep it printable within 24 x 32 cm with black negative space; no rectangular field, all-over print, exterior label text or random stock addition. Never suppress an approved bone, skull, web or cross merely because of its subject. Return one sharp photorealistic BACK photo."
            : " Follow the approved BACK artwork literally and keep it distinct from the front. Keep it printable within 24 x 32 cm with black negative space; no rectangular field, all-over print or exterior label text. Never substitute an unrelated skull, bone, cross, web, animal, mascot or stock gothic graphic. Return one sharp photorealistic BACK photo."
          : "";
  if (stageSuffix) {
    const available = maxLength - stageSuffix.length;
    const prefix = normalized.slice(0, available);
    const boundary = Math.max(prefix.lastIndexOf(". "), prefix.lastIndexOf("; "));
    return `${boundary > available * 0.65 ? prefix.slice(0, boundary + 1) : prefix}${stageSuffix}`;
  }
  const suffix = " Preserve a source heat-transfer marking only when it is physically visible inside the back-neck panel. Never create a hang tag, paper tag, sewn label, woven tab, white locator, fastener, string, cropped tag fragment or exterior label text. ABSOLUTELY NO animal, animal fragment, skull, horn, bone, star, horse, bison, buffalo, yak, organic anatomy, compass, crest, stock clipart or copied artwork. Return one sharp photorealistic designer-fashion product image.";
  const available = maxLength - suffix.length;
  const prefix = normalized.slice(0, available);
  const boundary = Math.max(prefix.lastIndexOf(". "), prefix.lastIndexOf("; "));
  return `${boundary > available * 0.65 ? prefix.slice(0, boundary + 1) : prefix}${suffix}`;
}

async function openProjectWorkspace(page: Page, flowUrl: string, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  let lastProjectClick = 0;
  let lastExperienceClick = 0;
  while (Date.now() < deadline) {
    if (page.url().startsWith("https://accounts.google.com/")) {
      throw new Error("Flow auth_required: complete the one-time Google sign-in in the persistent local Flow Chrome profile.");
    }
    if (page.url().startsWith("https://accounts.google.com/signin/oauth/error")) {
      throw new Error("Flow: требуется повторный вход в Google — OAuth авторизация завершилась ошибкой.");
    }
    if (isFlowAccessGateUrl(page.url())) {
      throw new Error("Flow access was rejected by Google: the signed-in account or current region was redirected to the Google Labs home page.");
    }
    if (await isFlowMarketingLandingPage(page)) {
      throw new Error("Flow access is unavailable: Google returned the marketing landing page instead of the project workspace.");
    }
    if (!isFlowRoute(page.url())) {
      const consent = await firstVisible(page, [
        'button:has-text("Agree")',
        'a[role="button"]:has-text("Agree")',
        'button:has-text("Принять")',
        'a[role="button"]:has-text("Принять")',
        'button:has-text("No thanks")',
        'a[role="button"]:has-text("No thanks")',
      ]);
      if (consent) {
        await consent.click({ timeout: 5_000 }).catch(() => undefined);
        await page.waitForTimeout(500);
        await page.goto(flowUrl, { waitUntil: "domcontentloaded", timeout: 45_000 });
        continue;
      }
      const flowLink = await firstVisible(page, [
        'a[href*="/tools/flow"]',
        'a[href*="/flow"]:has-text("Flow")',
      ]);
      const href = await flowLink?.getAttribute("href").catch(() => null);
      if (href) {
        await page.goto(new URL(href, page.url()).toString(), { waitUntil: "domcontentloaded", timeout: 45_000 });
        continue;
      }
    }
    if (Date.now() - lastExperienceClick >= 30_000) {
      const openedExperience = await openFlowExperience(page, [
        'button:has-text("Create with Google Flow")',
        'button:has-text("Create with Flow")',
      ]);
      if (openedExperience) {
        lastExperienceClick = Date.now();
        await page.waitForTimeout(500);
        continue;
      }
    }
    const prompt = await firstVisible(page, [
      '[role="textbox"]',
      'textarea',
      '[contenteditable="true"]',
    ]);
    if (prompt && (page.url().includes("/project/") || await page.locator('[data-testid="prompt"]').count())) return;

    if (!prompt && Date.now() - lastProjectClick >= 3_000) {
      const newProject = await firstVisible(page, [
        '[data-testid="new-project"]',
        'button[aria-label*="new project" i]',
        'button[aria-label*="новый проект" i]',
        'button:has-text("New project")',
        'button:has-text("Create project")',
        'button:has-text("Создать проект")',
        'button:has-text("Новый проект")',
        'button:has-text("Try in Google Flow")',
        'a:has-text("New project")',
        'a:has-text("Create project")',
        'a:has-text("Создать проект")',
        'a:has-text("Новый проект")',
        'a:has-text("Try in Google Flow")',
      ]) || await lastVisible(page, 'button:has-text("add_2")');
      if (newProject) {
        const clicked = await newProject.click({ timeout: 5_000 }).then(() => true).catch(() => false);
        if (clicked) lastProjectClick = Date.now();
      }
    }
    await page.waitForTimeout(500);
  }
  const actionLabels = await page.locator('button, a[role="button"]').evaluateAll((nodes) => nodes
    .filter((node) => (node as HTMLElement).offsetParent !== null)
    .map((node) => ((node as HTMLElement).innerText || node.getAttribute("aria-label") || "").replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .slice(0, 20))
    .catch(() => [] as string[]);
  throw await describeFlowPageError(
    page,
    new Error(`Flow: рабочая область не загрузилась за ${Math.round(timeoutMs / 1000)} секунд. URL: ${page.url()}. Видимые действия: ${actionLabels.join(" | ") || "нет"}.`),
  );
}

async function waitForFileInput(page: Page) {
  const direct = page.locator('input[type="file"]').first();
  await direct.waitFor({ state: "attached", timeout: 2_000 }).catch(() => undefined);
  if (await direct.count()) return direct;
  const upload = await waitForFirstVisible(page, [
    '[data-testid="upload-references"]',
    '[data-testid="add-media"]',
    'button:has-text("add_2")',
    'button[aria-label*="Upload" i]',
    'button:has-text("Upload")',
    'button[aria-label*="Add media" i]',
    'button[aria-label*="Add reference" i]',
    'button[aria-label*="Добавить медиа" i]',
    'button[aria-label*="Добавить референс" i]',
  ], 30_000);
  if (!upload) throw new Error("Flow: не найден элемент загрузки референсов.");
  await upload.click();
  await direct.waitFor({ state: "attached", timeout: 2_000 }).catch(() => undefined);
  if (await direct.count()) return direct;
  const uploadFromDevice = await waitForFirstVisible(page, [
    '[role="menuitem"]:has-text("Upload")',
    '[role="menuitem"]:has-text("Загрузить")',
    'button:has-text("Upload media")',
    'button:has-text("Upload from device")',
    'button:has-text("Загрузить медиа")',
    'button:has-text("С устройства")',
  ], 10_000);
  if (uploadFromDevice) await uploadFromDevice.click();
  await page.locator('input[type="file"]').first().waitFor({ state: "attached", timeout: 20_000 });
  return page.locator('input[type="file"]').first();
}

async function waitForResult(page: Page, timeoutMs: number, existingSources: Set<string>) {
  const selectors = [
    '[data-testid="result-image"]',
    'img[alt*="Generated" i]',
    'img[alt*="generation" i]',
    'img[alt*="Сгенерирован" i]',
  ];
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const modelLimit = await visibleFlowModelLimit(page);
    if (modelLimit) {
      await dismissFlowModelLimit(page);
      throw new FlowModelLimitError(`Flow исчерпал дневной лимит активной модели. ${modelLimit}`);
    }
    const generationError = await firstVisible(page, [
      'text="Что-то пошло не так. Повторите попытку."',
      'text="Something went wrong. Try again."',
      'text="Something went wrong"',
    ]);
    if (generationError) {
      throw new Error("Flow generation failed: Flow showed a retryable generation error.");
    }
    for (const selector of selectors) {
      const candidates = page.locator(selector);
      for (let index = await candidates.count() - 1; index >= 0; index -= 1) {
        const result = candidates.nth(index);
        if (!await result.isVisible().catch(() => false)) continue;
        const source = await result.evaluate((image) => (image as HTMLImageElement).src);
        const ready = await result.evaluate((image) => {
          const node = image as HTMLImageElement;
          return Boolean(node.src) && (node.naturalWidth > 32 || node.src.startsWith("data:"));
        });
        if (ready && !existingSources.has(source)) return result;
      }
    }
    await page.waitForTimeout(400);
  }
  throw new Error(`Flow не вернул изображение за ${Math.round(timeoutMs / 1000)} сек.`);
}

export function isFlowModelLimitText(text: string) {
  if (/дневн\w*\s+лимит|лимит\w*\s+(?:исчерпан|законч|достигнут|превышен)|квот\w*\s+(?:исчерпан|законч|достигнут|превышен)|попробуйте\s+(?:использовать|выбрать)\s+другую\s+модель|выберите\s+другую\s+модель/i.test(text)) return true;
  return /(?:daily\s+)?(?:usage\s+)?limit\s+(?:has\s+been\s+)?(?:reached|exceeded)|daily\s+quota|quota\s+(?:has\s+been\s+)?(?:reached|exceeded)|out\s+of\s+(?:generations|credits)|use\s+(?:a\s+)?different\s+model|try\s+(?:a\s+)?different\s+model|дневн\w*\s+лимит|лимит\w*\s+(?:исчерпан|законч|достигнут|превышен)|квот\w*\s+(?:исчерпан|законч|достигнут|превышен)|используйте\s+другую\s+модель|выберите\s+другую\s+модель/i.test(text);
}

async function visibleFlowModelLimit(page: Page) {
  const notices = await visibleFlowNotices(page);
  const notice = notices.find(isFlowModelLimitText);
  if (notice) return notice;
  // Flow sometimes renders the quota error as a regular assistant response,
  // without alert/dialog/aria-live semantics. Scan visible page text as well so
  // the agent switches models immediately instead of waiting for the timeout.
  const bodyText = await page.locator("body").innerText({ timeout: 2_000 }).catch(() => "");
  if (!isFlowModelLimitText(bodyText)) return "";
  return bodyText.split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line) => line && isFlowModelLimitText(line))
    .slice(-3)
    .join(" В· ")
    .slice(0, 900) || "Flow model daily limit reached; use another model.";
}

async function dismissFlowModelLimit(page: Page) {
  const dialogs = page.locator('[role="dialog"]');
  const count = Math.min(await dialogs.count().catch(() => 0), 8);
  for (let index = 0; index < count; index += 1) {
    const dialog = dialogs.nth(index);
    if (!await dialog.isVisible().catch(() => false)) continue;
    const text = (await dialog.innerText().catch(() => "")).replace(/\s+/g, " ").trim();
    if (!isFlowModelLimitText(text)) continue;
    for (const label of ["Закрыть", "Close", "Понятно", "Got it", "OK"]) {
      const button = dialog.locator(`button:has-text("${label}")`);
      if (await button.count().catch(() => 0) !== 1) continue;
      await button.click({ timeout: 5_000 }).catch(() => undefined);
      return;
    }
  }
  await page.keyboard.press("Escape").catch(() => undefined);
}

async function clickFirstVisible(page: Page, selectors: string[], required: boolean) {
  const locator = await firstVisible(page, selectors);
  if (locator) {
    await locator.click();
    return true;
  }
  if (required) throw new Error("Flow: не найден элемент загрузки референсов.");
  return false;
}

async function firstVisible(page: Page, selectors: string[]) {
  for (const selector of selectors) {
    const locator = page.locator(selector);
    const count = await locator.count();
    let visibleFallback: Locator | null = null;
    for (let index = 0; index < count; index += 1) {
      const candidate = locator.nth(index);
      if (!await candidate.isVisible().catch(() => false)) continue;
      visibleFallback ||= candidate;
      const inViewport = await candidate.evaluate((node) => {
        const rect = node.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0
          && rect.right > 0 && rect.bottom > 0
          && rect.left < window.innerWidth && rect.top < window.innerHeight;
      }).catch(() => false);
      if (inViewport) return candidate;
    }
    if (visibleFallback) return visibleFallback;
  }
  return null;
}

async function lastVisible(page: Page, selector: string) {
  const locator = page.locator(selector);
  for (let index = await locator.count() - 1; index >= 0; index -= 1) {
    const candidate = locator.nth(index);
    if (await candidate.isVisible().catch(() => false)) return candidate;
  }
  return null;
}

async function waitForFirstVisible(page: Page, selectors: string[], timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const locator = await firstVisible(page, selectors);
    if (locator) return locator;
    await page.waitForTimeout(500);
  }
  return null;
}

async function waitForFirstEnabled(page: Page, selectors: string[], timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const locator = await firstVisible(page, selectors);
    if (locator && await locator.isEnabled().catch(() => false)) return locator;
    await page.waitForTimeout(500);
  }
  return null;
}

async function describeFlowPageError(page: Page, fallback: unknown) {
  const notices = await visibleFlowNotices(page);
  const visibleNotice = [...new Set(notices)].join(" · ");
  if (isFlowModelLimitText(visibleNotice)) {
    return new FlowModelLimitError(`Flow исчерпал дневной лимит активной модели. ${visibleNotice}`);
  }
  if (/water\s?mark|водян/i.test(visibleNotice)) {
    return new Error(`Flow отклонил референс из-за водяного знака. Загрузите оригинальное фото без водяного знака и повторите задачу. Сообщение Flow: ${visibleNotice}`);
  }
  if (/copyright|авторск|content policy|policy violation|наруш.*политик/i.test(visibleNotice)) {
    return new Error(`Flow отклонил референс по правилам контента или авторских прав. Используйте собственное фото без чужих логотипов и повторите задачу. Сообщение Flow: ${visibleNotice}`);
  }
  if (/quota|limit reached|try again later|слишком много|повторите позже/i.test(visibleNotice)) {
    return new Error(`Flow временно ограничил генерации аккаунта. Подождите несколько минут и нажмите «Обновить» или создайте задачу повторно. Сообщение Flow: ${visibleNotice}`);
  }
  if (/unsupported.*(?:file|image)|(?:file|image).*unsupported|can't upload|cannot upload|не удалось загрузить/i.test(visibleNotice)) {
    return new Error(`Flow не принял один из файлов. Пересохраните фото в JPG или PNG без метаданных и водяных знаков. Сообщение Flow: ${visibleNotice}`);
  }
  return fallback instanceof Error ? fallback : new Error(String(fallback));
}

async function openFlowExperience(page: Page, selectors: string[]) {
  const entry = await firstVisible(page, selectors);
  if (!entry) return false;
  const destination = await entry.evaluate((node) => {
    const anchor = node instanceof HTMLAnchorElement ? node : node.closest("a");
    return anchor?.href || node.getAttribute("data-href") || node.getAttribute("data-url") || "";
  }).catch(() => "");
  if (/^https?:/i.test(destination)) {
    await page.goto(destination, { waitUntil: "domcontentloaded", timeout: 45_000 });
    return true;
  }
  const popupPromise = page.context().waitForEvent("page", { timeout: 5_000 }).catch(() => null);
  const clicked = await entry.click({ timeout: 5_000 }).then(() => true).catch(() => false);
  if (!clicked) return false;
  const popup = await popupPromise;
  if (popup) {
    await popup.waitForLoadState("domcontentloaded", { timeout: 15_000 }).catch(() => undefined);
    const popupUrl = popup.url();
    if (/^https?:/i.test(popupUrl)) {
      await page.goto(popupUrl, { waitUntil: "domcontentloaded", timeout: 45_000 });
    }
    await popup.close().catch(() => undefined);
  }
  return true;
}

async function visibleFlowNotices(page: Page) {
  const notices: string[] = [];
  for (const selector of ['[role="alert"]', '[role="dialog"]', '[aria-live="assertive"]']) {
    const locator = page.locator(selector);
    const count = Math.min(await locator.count().catch(() => 0), 8);
    for (let index = 0; index < count; index += 1) {
      const item = locator.nth(index);
      if (!await item.isVisible().catch(() => false)) continue;
      const text = (await item.innerText().catch(() => "")).replace(/\s+/g, " ").trim();
      if (text) notices.push(text.slice(0, 600));
    }
  }
  return notices;
}
