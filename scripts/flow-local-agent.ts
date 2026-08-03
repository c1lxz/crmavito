import { hostname } from "node:os";
import { spawn } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { loadEnvConfig } from "@next/env";
import { chromium, type Browser, type BrowserContext } from "playwright";
import { generateFlowImage } from "../lib/flow-agent/browser";
import { publicFlowAgentError, sanitizeFlowAgentError } from "../lib/flow-agent/errors";
import { normalizeFlowResult, type FlowImageSize } from "../lib/flow-agent/image-output";
import { buildOriginalDesignPrompt, collectMarketResearch, type MarketResearch } from "../lib/flow-agent/market-research";
import { browserPageFetch, evaluateFlowProductPhoto } from "../lib/flow-agent/quality";

loadEnvConfig(process.cwd());

type BackgroundSlot = "1" | "2" | "3" | "4";
type AgentJob = {
  id: string;
  imageSize: FlowImageSize;
  generationPrompt?: string;
  mode?: "product-photo" | "original-design";
  inspirationQuery?: string;
  designNote?: string;
  labelStyleReference?: string;
  marketResearch?: MarketResearch;
  designPrompt?: string;
  metaPromptSource?: "claude" | "fallback";
  products: Array<{ index: number; fileName: string }>;
  backgrounds: Array<{ slot: BackgroundSlot; fileName: string }>;
  results: Array<{ productIndex: number; backgroundSlot: BackgroundSlot }>;
};
type FlowAvailability = { state: "ready" | "blocked" | "auth_required" | "error"; message: string };

const baseUrl = (process.env.FLOW_AGENT_CRM_URL || "https://crmavito.duckdns.org").replace(/\/+$/, "");
const token = process.env.FLOW_LOCAL_AGENT_TOKEN?.trim() || "";
const flowUrl = process.env.FLOW_URL || "https://labs.google/fx/tools/flow";
const agentId = process.env.FLOW_AGENT_ID || hostname();
const concurrency = clamp(Number(process.env.FLOW_AGENT_CONCURRENCY || 1), 1, 6);
const pollMs = clamp(Number(process.env.FLOW_AGENT_POLL_MS || 750), 250, 30_000);
const generationTimeoutMs = clamp(Number(process.env.FLOW_GENERATION_TIMEOUT_MS || 240_000), 30_000, 600_000);
const generationMaxAttempts = clamp(Number(process.env.FLOW_GENERATION_MAX_ATTEMPTS || 3), 1, 5);
const qualityMaxAttempts = clamp(Number(process.env.FLOW_QUALITY_MAX_ATTEMPTS || 5), 1, 5);
const stateDirectory = path.resolve(process.env.FLOW_AGENT_STATE_DIR || ".flow-local-agent");
const profileDirectory = path.resolve(process.env.FLOW_AGENT_PROFILE_DIR || path.join(stateDirectory, "chrome-profile"));
const workDirectory = path.join(stateDirectory, "work");
const diagnosticsDirectory = path.join(stateDirectory, "diagnostics");
const proxyServer = process.env.FLOW_AGENT_PROXY_SERVER?.trim();
const proxyUsername = process.env.FLOW_AGENT_PROXY_USERNAME?.trim();
const proxyPassword = process.env.FLOW_AGENT_PROXY_PASSWORD?.trim();
const profileName = process.env.FLOW_AGENT_PROFILE_NAME?.trim();
const extensionPath = process.env.FLOW_AGENT_EXTENSION_PATH?.trim();
const cdpUrl = process.env.FLOW_AGENT_CDP_URL?.trim();
const cdpBootstrapScript = process.env.FLOW_AGENT_CDP_BOOTSTRAP_SCRIPT?.trim();
let sharedCdpBrowser: Browser | null = null;
let cdpBootstrapPromise: Promise<void> | null = null;

type FlowContextSession = {
  context: BrowserContext;
  close: () => Promise<void>;
  preservePages: boolean;
};

async function main() {
  if (!token) throw new Error("Задайте FLOW_LOCAL_AGENT_TOKEN.");
  await mkdir(workDirectory, { recursive: true });
  if (process.env.FLOW_AGENT_PREFLIGHT === "1") {
    const session = await launchFlowSession();
    try {
      const controlPage = await prepareControlPage(session.context, undefined, session.preservePages);
      await controlPage.goto(flowUrl, { waitUntil: "domcontentloaded", timeout: 45_000 });
      const summary = (await controlPage.locator("body").innerText()).replace(/\s+/g, " ").slice(0, 500);
      console.log(JSON.stringify({ url: controlPage.url(), title: await controlPage.title(), summary }));
    } finally {
      await session.close();
    }
    if (cdpUrl) process.exit(0);
    return;
  }
  console.log(`[flow-agent] ${agentId}; параллельность ${concurrency}; CRM ${baseUrl}`);
  const idleAvailability: FlowAvailability = {
    state: "ready",
    message: "Агент готов; Flow откроется только при запуске генерации.",
  };
  let currentAvailability = idleAvailability;
  let nextHeartbeatAt = 0;
  while (true) {
    if (Date.now() >= nextHeartbeatAt) {
      await reportStatus(currentAvailability).catch((error) => {
        console.error(`[flow-agent] heartbeat failed: ${error instanceof Error ? error.message : String(error)}`);
      });
      nextHeartbeatAt = Date.now() + 15_000;
    }
    let job: AgentJob | null;
    try {
      job = await claimJob();
    } catch (error) {
      console.error(`[flow-agent] CRM poll failed: ${error instanceof Error ? error.message : String(error)}`);
      await delay(Math.max(2_000, pollMs));
      continue;
    }
    if (!job) {
      await delay(pollMs);
      continue;
    }
    await runJobInFlow(job, (availability) => {
      currentAvailability = availability;
    }).then(() => {
      currentAvailability = idleAvailability;
    }).catch(async (error) => {
      const message = sanitizeFlowAgentError(error);
      console.error(`[flow-agent] ${job.id}: ${message}`);
      const canTryAnotherAgent = /регион|unsupported-country|требуется вход|auth_required|рабочая область не загрузилась|connectOverCDP|ECONNREFUSED|ERR_TUNNEL_CONNECTION_FAILED|ERR_CONNECTION_RESET|ERR_TIMED_OUT|proxy.*(?:failed|unavailable)|туннел|terminated|TargetClosedError|browser has been closed/i.test(message);
      const publicError = publicFlowAgentError(error);
      currentAvailability = {
        state: canTryAnotherAgent ? "blocked" : "error",
        message: publicError.split("\n")[0].replace(/^Error:\s*/, ""),
      };
      await reportStatus(currentAvailability).catch(() => undefined);
      await agentFetch(`/api/ai/content-machine/flow-agent/jobs/${job.id}/${canTryAnotherAgent ? "release" : "fail"}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ agentId, error: publicError }),
      }).catch(() => undefined);
    });
  }
}

async function launchFlowSession(): Promise<FlowContextSession> {
  if (cdpUrl) {
    if (!sharedCdpBrowser?.isConnected()) sharedCdpBrowser = await connectToShortcutChrome();
    const context = sharedCdpBrowser.contexts()[0];
    if (!context) throw new Error("Chrome из ярлыка запущен, но его профиль недоступен агенту.");
    return { context, close: async () => undefined, preservePages: true };
  }
  const context = await chromium.launchPersistentContext(profileDirectory, {
    channel: "chrome",
    headless: process.env.FLOW_AGENT_HEADLESS === "1",
    viewport: { width: 1440, height: 1000 },
    ignoreDefaultArgs: [
      "--no-sandbox",
      ...(profileName || extensionPath ? ["--disable-extensions"] : []),
    ],
    proxy: proxyServer ? {
      server: proxyServer,
      ...(proxyUsername ? { username: proxyUsername } : {}),
      ...(proxyPassword ? { password: proxyPassword } : {}),
    } : undefined,
    args: [
      "--disable-background-timer-throttling",
      "--disable-renderer-backgrounding",
      "--disable-session-crashed-bubble",
      "--hide-crash-restore-bubble",
      ...(profileName ? [`--profile-directory=${profileName}`] : []),
      ...(extensionPath ? [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`] : []),
    ],
  });
  return { context, close: () => context.close(), preservePages: false };
}

async function connectToShortcutChrome(): Promise<Browser> {
  if (!cdpUrl) throw new Error("FLOW_AGENT_CDP_URL не задан.");
  try {
    return rememberCdpBrowser(await chromium.connectOverCDP(cdpUrl));
  } catch (error) {
    if (!cdpBootstrapScript) throw error;
    console.warn("[flow-agent] Chrome из ярлыка закрыт; запускаю его тем же PowerShell-скриптом.");
    cdpBootstrapPromise ??= bootstrapShortcutChrome().finally(() => {
      cdpBootstrapPromise = null;
    });
    await cdpBootstrapPromise;
    return rememberCdpBrowser(await chromium.connectOverCDP(cdpUrl));
  }
}

function rememberCdpBrowser(browser: Browser) {
  browser.once("disconnected", () => {
    if (sharedCdpBrowser === browser) sharedCdpBrowser = null;
  });
  return browser;
}

async function bootstrapShortcutChrome() {
  if (!cdpBootstrapScript || !cdpUrl) return;
  await new Promise<void>((resolve, reject) => {
    const child = spawn("powershell.exe", [
      "-NoProfile",
      "-ExecutionPolicy", "Bypass",
      "-WindowStyle", "Hidden",
      "-File", cdpBootstrapScript,
    ], {
      windowsHide: true,
      stdio: "ignore",
    });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`PowerShell-ярлык Chrome завершился с кодом ${code ?? "unknown"}.`));
    });
  });

  let lastError: unknown;
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      const response = await fetch(`${cdpUrl.replace(/\/+$/, "")}/json/version`, {
        signal: AbortSignal.timeout(1_000),
      });
      if (response.ok) return;
      lastError = new Error(`CDP ответил HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await delay(500);
  }
  throw new Error(
    `Не удалось запустить Chrome через ярлык: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
  );
}

async function runJobInFlow(job: AgentJob, onAvailability?: (availability: FlowAvailability) => void) {
  const session = await launchFlowSession();
  const { context } = session;
  let minimizeTimer: ReturnType<typeof setInterval> | null = null;
  let controlPage: import("playwright").Page | null = null;
  try {
    controlPage = await prepareControlPage(context, undefined, session.preservePages);
    const availability = await probeFlow(controlPage);
    onAvailability?.(availability);
    await reportStatus(availability).catch(() => undefined);
    if (availability.state !== "ready") throw new Error(availability.message);
    minimizeTimer = setInterval(() => {
      if (controlPage && !controlPage.isClosed()) {
        void minimizeBrowserWindow(context, controlPage).catch(() => undefined);
      }
    }, 10_000);
    await processJob(context, job);
  } catch (error) {
    if (controlPage && !controlPage.isClosed()) {
      await mkdir(diagnosticsDirectory, { recursive: true }).catch(() => undefined);
      const screenshotPath = path.join(diagnosticsDirectory, `${job.id}-${Date.now()}.png`);
      const saved = await controlPage.screenshot({ path: screenshotPath, fullPage: true }).then(() => true).catch(() => false);
      if (saved) {
        throw new Error(`${error instanceof Error ? error.message : String(error)} Диагностический скриншот: ${screenshotPath}`);
      }
    }
    throw error;
  } finally {
    if (minimizeTimer) clearInterval(minimizeTimer);
    await session.close();
  }
}

async function prepareControlPage(
  context: BrowserContext,
  current?: import("playwright").Page,
  preservePages = false,
) {
  if (current && !current.isClosed()) return current;
  const pages = context.pages().filter((page) => !page.isClosed());
  const controlPage = pages.find((page) => page.url().startsWith(flowUrl)) || pages[0] || await context.newPage();
  if (!preservePages) {
    await Promise.all(pages.filter((page) => page !== controlPage).map((page) => page.close().catch(() => undefined)));
  }
  return controlPage;
}

async function minimizeBrowserWindow(context: BrowserContext, page: import("playwright").Page) {
  const session = await context.newCDPSession(page);
  try {
    const { windowId } = await session.send("Browser.getWindowForTarget");
    await session.send("Browser.setWindowBounds", {
      windowId,
      bounds: { windowState: "minimized" },
    });
  } finally {
    await session.detach().catch(() => undefined);
  }
}

async function probeFlow(page: import("playwright").Page): Promise<FlowAvailability> {
  try {
    await page.goto(flowUrl, { waitUntil: "domcontentloaded", timeout: 45_000 });
    const url = page.url();
    const unsupportedVisible = await page.getByText(/Flow is not available in your country/i)
      .isVisible()
      .catch(() => false);
    if (url.includes("/unsupported-country") || unsupportedVisible) {
      return { state: "blocked", message: "Google Flow показывает видимую блокировку региона для этого локального агента." };
    }
    if (url.includes("accounts.google.")) {
      return { state: "auth_required", message: "В профиле локального агента требуется вход в Google." };
    }
    return { state: "ready", message: "Google Flow доступен; агент готов к генерации." };
  } catch (error) {
    return { state: "error", message: error instanceof Error ? error.message : String(error) };
  }
}

async function reportStatus(availability: FlowAvailability) {
  const response = await agentFetch("/api/ai/content-machine/flow-agent/status", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      agentId,
      ...availability,
      checkedAt: new Date().toISOString(),
      concurrency,
    }),
  });
  if (!response.ok) throw new Error(`CRM вернула HTTP ${response.status}.`);
}

async function claimJob(): Promise<AgentJob | null> {
  const response = await agentFetch("/api/ai/content-machine/flow-agent/jobs/next", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ agentId }),
  });
  const text = await response.text();
  let data: { job: AgentJob | null; error?: string };
  try {
    data = JSON.parse(text) as typeof data;
  } catch {
    throw new Error(`CRM вернула не-JSON ответ, HTTP ${response.status}.`);
  }
  if (!response.ok) throw new Error(data.error || `CRM вернула HTTP ${response.status}.`);
  return data.job;
}

async function processJob(context: BrowserContext, job: AgentJob) {
  const jobDirectory = path.join(workDirectory, job.id);
  await rm(jobDirectory, { recursive: true, force: true });
  await mkdir(jobDirectory, { recursive: true });
  const products = new Map<number, string>();
  const backgrounds = new Map<BackgroundSlot, string>();
  await Promise.all([
    ...job.products.map(async (product) => {
      const target = path.join(jobDirectory, product.fileName);
      await downloadAsset(job.id, "products", product.fileName, target);
      products.set(product.index, target);
    }),
    ...job.backgrounds.map(async (background) => {
      const target = path.join(jobDirectory, background.fileName);
      await downloadAsset(job.id, "backgrounds", background.fileName, target);
      backgrounds.set(background.slot, target);
    }),
  ]);

  const completed = new Set(job.results.map((result) => `${result.productIndex}:${result.backgroundSlot}`));
  const work = job.mode === "original-design"
    ? job.backgrounds
      .filter((background) => !completed.has(`1:${background.slot}`))
      .map((background) => ({ product: job.products[0], background }))
    : job.products.flatMap((product) => job.backgrounds
      .filter((background) => !completed.has(`${product.index}:${background.slot}`))
      .map((background) => ({ product, background })));
  console.log(`[flow-agent] ${job.id}: ${work.length} фото`);
  const prompt = await resolveJobPrompt(job);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, work.length) }, async () => {
    let page = await context.newPage();
    try {
      while (cursor < work.length) {
        const item = work[cursor++];
        const outputPath = path.join(jobDirectory, `product-${String(item.product.index).padStart(2, "0")}-background-${item.background.slot}.png`);
        const productPath = products.get(item.product.index)!;
        const backgroundPath = backgrounds.get(item.background.slot)!;
        const references = job.mode === "original-design"
          ? [...job.products.map((product) => products.get(product.index)!), backgroundPath]
          : [productPath, backgroundPath];
        const requiresProductQa = job.mode !== "original-design";
        const angleDirection = flowAngleDirection(item.background.slot);
        let feedback = "";
        for (let attempt = 1; attempt <= (requiresProductQa ? qualityMaxAttempts : 1); attempt += 1) {
          let timing: Awaited<ReturnType<typeof generateFlowImage>> | undefined;
          for (let generationAttempt = 1; generationAttempt <= generationMaxAttempts; generationAttempt += 1) {
            try {
              timing = await generateFlowImage({
                page,
                flowUrl,
                references,
                prompt: feedback
                  ? `CRITICAL RETRY: ${feedback} ${angleDirection} Use IMAGE 1 as the only product; ignore every garment, print, label, text and watermark in IMAGE 2. ${prompt}`
                  : `${angleDirection} ${prompt}`,
                outputPath,
                timeoutMs: generationTimeoutMs,
                maxOutputEdge: job.imageSize === "4K" ? 4096 : 2048,
                downloadResolution: "2K",
              });
              break;
            } catch (error) {
              if (!isRetryableGenerationError(error) || generationAttempt === generationMaxAttempts) throw error;
              const reason = sanitizeFlowAgentError(error);
              console.warn(
                `[flow-agent] ${job.id} ${item.product.index}/${item.background.slot}: Flow retry ${generationAttempt}/${generationMaxAttempts}: ${reason}`,
              );
              await page.close().catch(() => undefined);
              await delay(Math.min(2_000 * generationAttempt, 6_000));
              page = await context.newPage();
            }
          }
          if (!timing) throw new Error(`Flow generation failed for ${item.product.index}/${item.background.slot}.`);
          const verdict = requiresProductQa
            ? await evaluateFlowProductPhoto(
              { productPath, backgroundPath, candidatePath: outputPath },
              { fetchFn: browserPageFetch(page) },
            )
            : { pass: true, score: 100, issues: [], skipped: true };
          if (verdict.pass) {
            await uploadResult(job.id, item.product.index, item.background.slot, outputPath, timing, job.imageSize);
            console.log(`[flow-agent] ${job.id} ${item.product.index}/${item.background.slot}: ${(timing.durationMs / 1000).toFixed(1)} сек; QA ${verdict.skipped ? "skipped" : verdict.score}`);
            break;
          }
          feedback = verdict.issues.join("; ").slice(0, 320) || `product fidelity score was ${verdict.score}/100`;
          console.warn(`[flow-agent] ${job.id} ${item.product.index}/${item.background.slot}: QA ${verdict.score}, retry ${attempt}/${qualityMaxAttempts}: ${feedback}`);
          if (attempt === qualityMaxAttempts) {
            throw new Error(`Flow QA rejected ${item.product.index}/${item.background.slot} after ${qualityMaxAttempts} attempts: ${feedback}`);
          }
        }
      }
    } finally {
      await page.close();
    }
  });
  const outcomes = await Promise.allSettled(workers);
  const failed = outcomes.find((outcome): outcome is PromiseRejectedResult => outcome.status === "rejected");
  if (failed) throw failed.reason;
}

function isRetryableGenerationError(error: unknown) {
  const message = sanitizeFlowAgentError(error).toLowerCase();
  return [
    "не вернул изображение",
    "timeout",
    "timed out",
    "err_timed_out",
    "err_connection_reset",
    "err_tunnel_connection_failed",
    "target page",
    "browser has been closed",
    "terminated",
    "flow generation failed",
    "download",
  ].some((fragment) => message.includes(fragment));
}

function flowAngleDirection(slot: BackgroundSlot) {
  const directions: Record<BackgroundSlot, string> = {
    "1": "ANGLE VARIANT 1: use a clean near-overhead full-garment view while matching IMAGE 2 perspective.",
    "2": "ANGLE VARIANT 2: use a natural three-quarter diagonal view from the upper-left while matching IMAGE 2 perspective.",
    "3": "ANGLE VARIANT 3: use a lower oblique camera angle with stronger depth, keeping the whole garment readable and matching IMAGE 2 perspective.",
    "4": "ANGLE VARIANT 4: use the opposite three-quarter diagonal view from the upper-right while matching IMAGE 2 perspective.",
  };
  return directions[slot];
}

async function resolveJobPrompt(job: AgentJob) {
  if (job.mode !== "original-design") return job.generationPrompt || defaultPrompt();
  if (job.designPrompt) return job.designPrompt;
  let research = job.marketResearch;
  if (!research) {
    const query = job.inspirationQuery?.trim();
    if (!query) throw new Error("Для режима нового дизайна не задан рыночный запрос.");
    let browser: Browser | null = null;
    try {
      browser = await chromium.launch({
        channel: "chrome",
        headless: process.env.FLOW_RESEARCH_HEADLESS !== "0",
      });
      research = await collectMarketResearch(browser, query);
    } finally {
      await browser?.close();
    }
    await saveResearch(job.id, research);
  }
  try {
    return await requestMetaPrompt(job.id);
  } catch (error) {
    console.warn(`[flow-agent] Claude meta-prompt failed, using fallback: ${error instanceof Error ? error.message : String(error)}`);
    return buildOriginalDesignPrompt(research, job.designNote, job.labelStyleReference, job.products.length);
  }
}

async function saveResearch(jobId: string, research: MarketResearch) {
  const response = await agentFetch(`/api/ai/content-machine/flow-agent/jobs/${jobId}/research`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ agentId, research }),
  });
  if (!response.ok) throw new Error(`CRM не приняла исследование рынка: HTTP ${response.status} ${await response.text()}`);
}

async function requestMetaPrompt(jobId: string) {
  const response = await agentFetch(`/api/ai/content-machine/flow-agent/jobs/${jobId}/meta-prompt`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ agentId }),
  });
  const data = await response.json() as { prompt?: string; error?: string };
  if (!response.ok || !data.prompt) throw new Error(data.error || `CRM вернула HTTP ${response.status}.`);
  return data.prompt;
}

async function downloadAsset(jobId: string, kind: string, fileName: string, target: string) {
  const response = await agentFetch(`/api/ai/content-machine/flow-agent/jobs/${jobId}/asset/${kind}/${encodeURIComponent(fileName)}`);
  if (!response.ok) throw new Error(`Не удалось скачать ${fileName}: HTTP ${response.status}.`);
  await writeFile(target, Buffer.from(await response.arrayBuffer()));
}

async function uploadResult(
  jobId: string,
  productIndex: number,
  backgroundSlot: BackgroundSlot,
  filePath: string,
  timing: Awaited<ReturnType<typeof generateFlowImage>>,
  imageSize: FlowImageSize,
) {
  const form = new FormData();
  form.set("agentId", agentId);
  form.set("productIndex", String(productIndex));
  form.set("backgroundSlot", backgroundSlot);
  for (const [key, value] of Object.entries(timing)) form.set(key, String(value));
  const source = await readFile(filePath);
  const normalized = await normalizeFlowResult(source, imageSize);
  const payload = new Uint8Array(normalized.length);
  payload.set(normalized);
  form.set("file", new Blob([payload], { type: "image/png" }), path.basename(filePath));
  const response = await agentFetch(`/api/ai/content-machine/flow-agent/jobs/${jobId}/result`, { method: "POST", body: form });
  if (!response.ok) throw new Error(`CRM не приняла результат: HTTP ${response.status} ${await response.text()}`);
}

function agentFetch(route: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${token}`);
  return fetch(`${baseUrl}${route}`, { ...init, headers, signal: AbortSignal.timeout(120_000) });
}

function defaultPrompt() {
  return "Create exactly one photorealistic e-commerce product photo. Use the first image as the exact product identity and the second image as the exact background, composition and lighting reference. Preserve print, color, seams, text, proportions and visible side. Return only the final image.";
}

function clamp(value: number, min: number, max: number) {
  return Number.isFinite(value) ? Math.min(max, Math.max(min, Math.round(value))) : min;
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function supervise() {
  while (true) {
    try {
      await main();
      return;
    } catch (error) {
      const message = sanitizeFlowAgentError(error);
      console.error(`[flow-agent] session stopped: ${message}`);
      await reportStatus({
        state: "error",
        message: "Локальный Flow-агент перезапускается после ошибки.",
      }).catch(() => undefined);
      await delay(3_000);
    }
  }
}

void supervise();
