import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Page } from "playwright";

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
      uploadError = error;
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
  await promptInput.fill(compactFlowPrompt(input.prompt));

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
  } else if (source && !source.startsWith("blob:")) {
    await writeFile(
      input.outputPath,
      await downloadResultImage(input.page, new URL(source, input.page.url()).toString()),
    );
  } else {
    const downloadButton = await firstVisible(input.page, [
      '[data-testid="result-download"]',
      'button[aria-label*="Download" i]',
      'button:has-text("Download")',
    ]);
    if (!downloadButton) throw new Error("Flow: у результата нет доступной кнопки скачивания.");
    const downloadPromise = input.page.waitForEvent("download", { timeout: 30_000 });
    await downloadButton.click();
    const download = await downloadPromise;
    await download.saveAs(input.outputPath);
  }
  const finished = Date.now();
  return {
    startedAt,
    durationMs: finished - started,
    uploadMs: uploadFinished - started,
    generationMs: generatedAt - uploadFinished,
  };
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
        signal: AbortSignal.timeout(90_000),
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
    const timeout = setTimeout(() => controller.abort(), 90_000);
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
  const addMedia = await waitForFirstVisible(page, [
    '[data-testid="add-media"]',
    'button:has-text("add_2")',
  ], 30_000);
  if (!addMedia) throw new Error("Flow: не найдена кнопка прикрепления референсов.");
  await addMedia.click();

  for (const reference of references) {
    const fileName = path.basename(reference);
    const image = page.locator(`[role="dialog"] img[alt=${JSON.stringify(fileName)}]`).last();
    await image.waitFor({ state: "visible", timeout: 60_000 });
    await image.click();
  }

  const attach = await waitForFirstEnabled(page, [
    'button:has-text("Add to prompt")',
    'button:has-text("Add to request")',
    'button:has-text("Добавить в запрос")',
  ], 20_000);
  if (!attach) throw new Error("Flow: загруженные референсы не удалось добавить в запрос.");
  await attach.click();
}

function compactFlowPrompt(prompt: string) {
  const normalized = prompt.replace(/\s+/g, " ").trim();
  if (normalized.length <= 900) return normalized;
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
  throw new Error(`Flow: рабочая область не загрузилась за ${Math.round(timeoutMs / 1000)} секунд.`);
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
