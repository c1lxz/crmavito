import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Locator, Page } from "playwright";
import { buildFlowProductPhotoPrompt } from "../ai/gemini-images";

export type FlowRunTiming = {
  startedAt: string;
  durationMs: number;
  uploadMs: number;
  generationMs: number;
};

export async function generateFlowImage(input: {
  page: Page;
  flowUrl: string;
  references: string[];
  prompt: string;
  outputPath: string;
  timeoutMs: number;
  maxOutputEdge?: 2048 | 4096;
}): Promise<FlowRunTiming> {
  const started = Date.now();
  const startedAt = new Date(started).toISOString();
  await input.page.goto(input.flowUrl, { waitUntil: "domcontentloaded", timeout: 45_000 });
  if (await input.page.getByText("Flow is not available in your country yet.").isVisible().catch(() => false)) {
    throw new Error("Google Flow недоступен из текущего региона. Включите VPN в профиле локального агента.");
  }

  await clickFirstVisible(input.page, [
    'button:has-text("Hide")',
    'button:has-text("No thanks")',
    'button:has-text("Нет, спасибо")',
  ], false);
  const openedFlow = await clickFirstVisible(input.page, [
    'button:has-text("Create with Google Flow")',
    'button:has-text("Create with Flow")',
  ], false);
  if (openedFlow) await input.page.waitForTimeout(2_000);
  await openProjectWorkspace(input.page, 90_000);

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
  if (source?.startsWith("data:")) {
    await writeFile(input.outputPath, Buffer.from(source.split(",", 2)[1], "base64"));
  } else if (source) {
    const absoluteSource = source.startsWith("blob:") ? source : new URL(source, input.page.url()).toString();
    let downloaded = false;
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
    if (!downloaded) {
      downloaded = await downloadWithFlowButton(input.page, input.outputPath);
    }
    if (!downloaded) await captureRenderedResult(result, input.outputPath, input.maxOutputEdge || 2048);
  } else {
    const downloaded = await downloadWithFlowButton(input.page, input.outputPath);
    if (!downloaded) throw new Error("Flow: у результата нет доступного изображения или кнопки скачивания.");
  }
  const finished = Date.now();
  return {
    startedAt,
    durationMs: finished - started,
    uploadMs: uploadFinished - started,
    generationMs: generatedAt - uploadFinished,
  };
}

async function downloadWithFlowButton(page: Page, outputPath: string) {
  try {
    const downloadButton = await firstVisible(page, [
      '[data-testid="result-download"]',
      'button[aria-label*="Download" i]',
      'button:has-text("Download")',
    ]);
    if (!downloadButton) return false;
    const downloadPromise = page.waitForEvent("download", { timeout: 30_000 });
    await downloadButton.click();
    const download = await downloadPromise;
    await download.saveAs(outputPath);
    return true;
  } catch {
    return false;
  }
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

    const attach = await waitForFirstEnabled(page, [
      'button:has-text("Add to prompt")',
      'button:has-text("Add to request")',
      'button:has-text("Добавить в запрос")',
    ], 20_000);
    if (!attach) throw new Error("Flow: загруженный референс не удалось добавить в запрос.");
    await attach.click();
    await page.locator('[role="dialog"]').waitFor({ state: "hidden", timeout: 20_000 });
  }
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
  const normalized = prompt.replace(/\s+/g, " ").trim();
  if (normalized.length <= 900) return normalized;
  if (normalized.includes("immutable product identity") && normalized.includes("REFERENCE IMAGE 1")) {
    return buildFlowProductPhotoPrompt();
  }
  const labelSuffix = normalized.includes("CUSTOM MADE")
    ? " Add exactly one single-line back-neck heat-transfer marking reading 'CUSTOM MADE', printed directly on fabric; no repeat, second line, sewn tag, reference name or logo."
    : "";
  const suffix = `${labelSuffix} Original visual design only: no copied artwork, logos, brands, characters, watermarks or UI. Return one sharp photorealistic marketplace product image.`;
  const available = 900 - suffix.length;
  const prefix = normalized.slice(0, available);
  const boundary = Math.max(prefix.lastIndexOf(". "), prefix.lastIndexOf("; "));
  return `${boundary > available * 0.65 ? prefix.slice(0, boundary + 1) : prefix}${suffix}`;
}

async function openProjectWorkspace(page: Page, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  let lastProjectClick = 0;
  while (Date.now() < deadline) {
    const prompt = await firstVisible(page, [
      '[role="textbox"]',
      'textarea',
      '[contenteditable="true"]',
    ]);
    if (prompt && (page.url().includes("/project/") || await page.locator('[data-testid="prompt"]').count())) return;

    if (!prompt && Date.now() - lastProjectClick >= 3_000) {
      const newProject = await firstVisible(page, [
        '[data-testid="new-project"]',
        'button:has-text("New project")',
        'button:has-text("Create project")',
        'button:has-text("Создать проект")',
      ]) || await lastVisible(page, 'button:has-text("add_2")');
      if (newProject) {
        const clicked = await newProject.click({ timeout: 5_000 }).then(() => true).catch(() => false);
        if (clicked) lastProjectClick = Date.now();
      }
    }
    await page.waitForTimeout(500);
  }
  throw await describeFlowPageError(
    page,
    new Error(`Flow: рабочая область не загрузилась за ${Math.round(timeoutMs / 1000)} секунд.`),
  );
}

async function waitForFileInput(page: Page) {
  const direct = page.locator('input[type="file"]').first();
  await direct.waitFor({ state: "attached", timeout: 30_000 }).catch(() => undefined);
  if (await direct.count()) return direct;
  const upload = await waitForFirstVisible(page, [
    '[data-testid="upload-references"]',
    'button[aria-label*="Upload" i]',
    'button:has-text("Upload")',
    'button[aria-label*="Add media" i]',
    'button[aria-label*="Add reference" i]',
    'button[aria-label*="Добавить медиа" i]',
    'button[aria-label*="Добавить референс" i]',
  ], 30_000);
  if (!upload) throw new Error("Flow: не найден элемент загрузки референсов.");
  await upload.click();
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
    const result = await firstVisible(page, selectors);
    if (result) {
      const source = await result.evaluate((image) => (image as HTMLImageElement).src);
      const ready = await result.evaluate((image) => {
        const node = image as HTMLImageElement;
        return Boolean(node.src) && (node.naturalWidth > 32 || node.src.startsWith("data:"));
      });
      if (ready && !existingSources.has(source)) return result;
    }
    await page.waitForTimeout(400);
  }
  throw new Error(`Flow не вернул изображение за ${Math.round(timeoutMs / 1000)} сек.`);
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
    for (let index = 0; index < count; index += 1) {
      const candidate = locator.nth(index);
      if (await candidate.isVisible().catch(() => false)) return candidate;
    }
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
  const visibleNotice = [...new Set(notices)].join(" · ");
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
