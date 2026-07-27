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
    '[data-testid="new-project"]',
    'button:has-text("New project")',
    'button:has-text("Create project")',
    'button:has-text("Create with Flow")',
  ], false);

  const fileInput = await waitForFileInput(input.page);
  await fileInput.setInputFiles(input.references);
  const uploadFinished = Date.now();

  const promptInput = await firstVisible(input.page, [
    '[data-testid="prompt"]',
    'textarea[placeholder*="prompt" i]',
    'textarea',
    '[contenteditable="true"][role="textbox"]',
  ]);
  if (!promptInput) throw new Error("Flow: не найдено поле промпта.");
  await promptInput.fill(input.prompt);

  const generateButton = await firstVisible(input.page, [
    '[data-testid="generate"]',
    'button:has-text("Generate")',
    'button[aria-label*="Generate" i]',
    'button:has-text("Create")',
  ]);
  if (!generateButton) throw new Error("Flow: не найдена кнопка генерации.");
  await generateButton.click();

  const result = await waitForResult(input.page, input.timeoutMs);
  const generatedAt = Date.now();
  await mkdir(path.dirname(input.outputPath), { recursive: true });
  const source = await result.getAttribute("src");
  if (source?.startsWith("data:")) {
    await writeFile(input.outputPath, Buffer.from(source.split(",", 2)[1], "base64"));
  } else if (source && !source.startsWith("blob:")) {
    const response = await input.page.request.get(source);
    if (!response.ok()) throw new Error(`Flow: результат не скачан, HTTP ${response.status()}.`);
    await writeFile(input.outputPath, await response.body());
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

async function waitForFileInput(page: Page) {
  const direct = page.locator('input[type="file"]');
  if (await direct.count()) return direct.first();
  await clickFirstVisible(page, [
    '[data-testid="upload-references"]',
    'button[aria-label*="Upload" i]',
    'button:has-text("Upload")',
    'button[aria-label*="Add media" i]',
    'button[aria-label*="Add reference" i]',
  ], true);
  await page.locator('input[type="file"]').first().waitFor({ state: "attached", timeout: 10_000 });
  return page.locator('input[type="file"]').first();
}

async function waitForResult(page: Page, timeoutMs: number) {
  const selectors = [
    '[data-testid="result-image"]',
    'img[alt*="Generated" i]',
    'img[alt*="generation" i]',
  ];
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await firstVisible(page, selectors);
    if (result) {
      const ready = await result.evaluate((image) => {
        const node = image as HTMLImageElement;
        return Boolean(node.src) && (node.naturalWidth > 32 || node.src.startsWith("data:"));
      });
      if (ready) return result;
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
