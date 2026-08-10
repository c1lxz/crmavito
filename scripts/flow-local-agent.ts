import { hostname } from "node:os";
import { spawn } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { loadEnvConfig } from "@next/env";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import sharp from "sharp";
import {
  FLOW_IMAGE_MODELS,
  FlowModelLimitError,
  generateFlowImage,
  inferFlowImageAspectRatio,
  isFlowAccessGateUrl,
  isFlowMarketingLandingPage,
  type FlowImageModel,
} from "../lib/flow-agent/browser";
import { publicFlowAgentError, sanitizeFlowAgentError } from "../lib/flow-agent/errors";
import {
  compareFlowImageGeometry,
  normalizeFlowResult,
  type FlowImageSize,
} from "../lib/flow-agent/image-output";
import { buildOriginalDesignPrompt, collectMarketResearch, type MarketResearch } from "../lib/flow-agent/market-research";
import {
  browserPageFetch,
  evaluateCentralPrintPresence,
  evaluateCornerWatermarkRisk,
  evaluateFlowOriginalDesignAnchor,
  evaluateFlowOriginalDesignPair,
  evaluateFlowProductPhoto,
  type FlowPhotoQualityVerdict,
} from "../lib/flow-agent/quality";
import { buildOriginalFrontSeedPrompt, buildOriginalStagePrompt, type OriginalDesignStage } from "../lib/flow-agent/original-design";
import { evaluateShotDiversity } from "../lib/flow-agent/shot-diversity";
import { applyExactLabelOverlay, createBestLabelAssets } from "../lib/flow-agent/label-lock";
import type { NeckLabelTarget } from "../lib/flow-agent/label-target";
import {
  createClaudeApparelDesignPrompt,
  createGeminiApparelDesignPrompt,
  inferWinnerMarketQuery,
  isApprovedContentMachineDesignPrompt,
} from "../lib/flow-agent/design-brief";

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
  preserveWinnerLabel?: boolean;
  marketResearch?: MarketResearch;
  designPrompt?: string;
  metaPromptSource?: "gemini" | "claude" | "fallback";
  products: Array<{ index: number; fileName: string }>;
  backgrounds: Array<{ slot: BackgroundSlot; fileName: string }>;
  results: Array<{ productIndex: number; backgroundSlot: BackgroundSlot; fileName?: string }>;
};
type FlowAvailability = { state: "ready" | "blocked" | "auth_required" | "error"; message: string };

const baseUrl = (process.env.FLOW_AGENT_CRM_URL || "https://crmavito.duckdns.org").replace(/\/+$/, "");
const token = process.env.FLOW_LOCAL_AGENT_TOKEN?.trim() || "";
const flowUrl = process.env.FLOW_URL || "https://labs.google/fx/ru/tools/flow";
const agentId = process.env.FLOW_AGENT_ID || hostname();
const concurrency = clamp(Number(process.env.FLOW_AGENT_CONCURRENCY || 1), 1, 6);
const pollMs = clamp(Number(process.env.FLOW_AGENT_POLL_MS || 750), 250, 30_000);
const generationTimeoutMs = clamp(Number(process.env.FLOW_GENERATION_TIMEOUT_MS || 240_000), 30_000, 600_000);
const generationMaxAttempts = clamp(Number(process.env.FLOW_GENERATION_MAX_ATTEMPTS || 4), 1, 5);
const qualityMaxAttempts = clamp(Number(process.env.FLOW_QUALITY_MAX_ATTEMPTS || 5), 1, 5);
const stateDirectory = path.resolve(process.env.FLOW_AGENT_STATE_DIR || ".flow-local-agent");
const profileDirectory = path.resolve(process.env.FLOW_AGENT_PROFILE_DIR || path.join(stateDirectory, "chrome-profile"));
const workDirectory = path.join(stateDirectory, "work");
const diagnosticsDirectory = path.join(stateDirectory, "diagnostics");
const flowProjectStatePath = path.join(stateDirectory, "last-flow-project-url.txt");
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
    console.error("[flow-agent] preflight started.");
    const watchdog = setTimeout(() => {
      console.error("[flow-agent] preflight timed out after 40 seconds; Chrome/CDP did not answer.");
      process.exit(2);
    }, 40_000);
    const session = await launchFlowSession();
    try {
      const controlPage = await prepareControlPage(session.context, undefined, session.preservePages);
      await controlPage.goto(flowUrl, { waitUntil: "domcontentloaded", timeout: 35_000 });
      const summary = (await controlPage.locator("body").innerText({ timeout: 5_000 })).replace(/\s+/g, " ").slice(0, 500);
      console.log(JSON.stringify({ url: controlPage.url(), title: await controlPage.title(), summary }));
    } finally {
      clearTimeout(watchdog);
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
  await reportStatus(currentAvailability).catch((error) => {
    console.error(`[flow-agent] heartbeat failed: ${error instanceof Error ? error.message : String(error)}`);
  });
  const heartbeatTimer = setInterval(() => {
    void reportStatus(currentAvailability).catch((error) => {
        console.error(`[flow-agent] heartbeat failed: ${error instanceof Error ? error.message : String(error)}`);
      });
  }, 15_000);
  try {
    while (true) {
      if (cdpUrl) {
        const availability = await probeLocalFlowBeforeClaim();
        currentAvailability = availability;
        await reportStatus(availability).catch(() => undefined);
        if (availability.state !== "ready") {
          if (availability.state === "auth_required") {
            console.warn("[flow-agent] Flow session requires sign-in; keeping every CRM job queued until the existing profile is ready.");
            await waitForLocalFlowRecovery();
            currentAvailability = idleAvailability;
          } else {
            await delay(Math.max(15_000, pollMs));
          }
          continue;
        }
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
      currentAvailability = {
        state: "ready",
        message: `Flow обрабатывает ${job.id}; готовые фото сразу отправляются в CRM.`,
      };
      await runJobInFlow(job, (availability) => {
        currentAvailability = availability;
      }).then(() => {
        currentAvailability = idleAvailability;
      }).catch(async (error) => {
        const message = sanitizeFlowAgentError(error);
        console.error(`[flow-agent] ${job.id}: ${message}`);
        const canTryAnotherAgent = /регион|unsupported-country|требуется вход|auth_required|рабочая область не загрузилась|marketing page|redirected Flow|Flow access (?:is unavailable|was rejected)|Flow showed a retryable generation error|не вернул изображение|connectOverCDP|ECONNREFUSED|ERR_TUNNEL_CONNECTION_FAILED|ERR_CONNECTION_RESET|ERR_TIMED_OUT|proxy.*(?:failed|unavailable)|туннел|terminated|TargetClosedError|browser has been closed/i.test(message);
        const publicError = publicFlowAgentError(error);
        currentAvailability = {
          state: canTryAnotherAgent ? "blocked" : "error",
          message: publicError.split("\n")[0].replace(/^Error:\s*/, ""),
        };
        await reportStatus(currentAvailability).catch(() => undefined);
        const localInteractiveAuthBlock = Boolean(cdpUrl) && /auth_required|requires? (?:a )?(?:one-time |repeat )?sign-in|marketing page/i.test(message);
        if (localInteractiveAuthBlock) {
          console.warn(`[flow-agent] ${job.id}: paused on the same job until the persistent Flow Chrome profile is signed in.`);
          await waitForLocalFlowRecovery();
          currentAvailability = idleAvailability;
          return;
        }
        await agentFetch(`/api/ai/content-machine/flow-agent/jobs/${job.id}/${canTryAnotherAgent ? "release" : "fail"}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ agentId, error: publicError }),
        }).catch(() => undefined);
      });
    }
  } finally {
    clearInterval(heartbeatTimer);
  }
}

async function probeLocalFlowBeforeClaim(): Promise<FlowAvailability> {
  const session = await launchFlowSession();
  try {
    const page = await prepareControlPage(session.context, undefined, session.preservePages);
    return await probeFlow(page, { requireWorkspace: true });
  } catch (error) {
    return { state: "error", message: error instanceof Error ? error.message : String(error) };
  } finally {
    await session.close().catch(() => undefined);
  }
}

async function waitForLocalFlowRecovery() {
  while (true) {
    try {
      const session = await launchFlowSession();
      const page = await prepareControlPage(session.context, undefined, session.preservePages);
      if ((await probeFlow(page, { requireWorkspace: true })).state === "ready") return;
    } catch {
      // Keep the claimed job paused until the user finishes the one-time login.
    }
    await delay(3_000);
  }
}

function isFlowRouteUrl(url: string) {
  try {
    return /^\/fx\/(?:[a-z]{2}\/)?tools\/flow(?:\/|$)/i.test(new URL(url).pathname);
  } catch {
    return false;
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
    // The dedicated Chrome already owns the persisted proxy extension state.
    // Re-applying it on every agent reconnect resets live Google sessions and
    // can send an authenticated Flow project back through OAuth mid-generation.
    return rememberCdpBrowser(await chromium.connectOverCDP(cdpUrl));
  } catch (error) {
    if (!cdpBootstrapScript) throw error;
    console.warn("[flow-agent] Chrome из ярлыка закрыт; запускаю его тем же PowerShell-скриптом.");
    cdpBootstrapPromise ??= bootstrapShortcutChrome().finally(() => {
      cdpBootstrapPromise = null;
    });
    await cdpBootstrapPromise;
    const browser = rememberCdpBrowser(await chromium.connectOverCDP(cdpUrl));
    await configureLocalProxyExtension(browser);
    return browser;
  }
}

async function configureLocalProxyExtension(browser: Browser) {
  const specification = process.env.FLOW_AGENT_PROXY_SPEC?.trim();
  if (!specification) return;
  const match = specification.match(/^(?:([^:@]+):([^@]+)@)?([^:]+):(\d+)$/);
  if (!match) throw new Error("FLOW_AGENT_PROXY_SPEC has an invalid format.");
  const [, user = "", pass = "", ip, port] = match;
  const extensionId = process.env.FLOW_AGENT_PROXY_EXTENSION_ID?.trim() || "pcboajngloecgmaailkmphmpbacmbcfb";
  const context = browser.contexts()[0];
  if (!context) throw new Error("Chrome did not expose a profile for proxy setup.");
  const page = await context.newPage();
  try {
    await page.goto(`chrome-extension://${extensionId}/popup.html`, { waitUntil: "domcontentloaded", timeout: 15_000 });
    const response = await page.evaluate(async (proxy) => {
      const extension = (globalThis as typeof globalThis & {
        chrome?: { runtime?: { sendMessage?: (message: unknown) => Promise<{ status?: string }> } };
      }).chrome;
      if (!extension?.runtime?.sendMessage) throw new Error("Simple Proxy Switcher is not loaded.");
      // The extension can be configured to clear cookies/cache and reload all
      // tabs whenever a proxy is applied. That destroys the one-time Flow OAuth
      // session, so the local agent must explicitly disable those side effects.
      for (const key of ["remove_cookies", "remove_cache", "reload_current_tab", "reload_other_tabs"]) {
        const option = await extension.runtime.sendMessage({ action: "set_option", key, val: false });
        if (option?.status !== "ok") throw new Error(`Simple Proxy Switcher did not disable ${key}.`);
      }
      return extension.runtime.sendMessage({ action: "set_proxy", data: proxy });
    }, { user, pass, ip, port });
    if (response?.status !== "ok") throw new Error("Simple Proxy Switcher did not apply the proxy.");
  } finally {
    await page.close().catch(() => undefined);
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
    await processJob(context, job, controlPage);
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
  const controlPage = pages.find((page) => /\/tools\/flow\/project\//i.test(page.url()))
    || pages.find((page) => page.url().startsWith(flowUrl))
    || pages[0]
    || await context.newPage();
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

async function probeFlow(
  page: import("playwright").Page,
  options: { requireWorkspace?: boolean } = {},
): Promise<FlowAvailability> {
  try {
    const savedProjectUrl = await readFile(flowProjectStatePath, "utf8")
      .then((value) => value.trim())
      .catch(() => "");
    const currentUrl = page.url();
    const targetUrl = /\/tools\/flow\/project\//i.test(currentUrl)
      ? currentUrl
      : /\/tools\/flow\/project\//i.test(savedProjectUrl)
        ? savedProjectUrl
        : flowUrl;
    if (currentUrl !== targetUrl) {
      await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 45_000 });
    }
    // Google can first render the saved Flow project URL and only then finish
    // an OAuth redirect. Give that redirect a moment to settle before a job is
    // claimed, otherwise research starts against a page that is already leaving.
    await page.waitForTimeout(2_500);
    const url = page.url();
    const googleSignInVisible = await page.locator('input[type="email"], input[autocomplete="username"]')
      .first()
      .isVisible()
      .catch(() => false);
    if (url.includes("accounts.google.") || googleSignInVisible) {
      return { state: "auth_required", message: "В профиле локального агента требуется вход в Google." };
    }
    if (isFlowAccessGateUrl(url)) {
      return {
        state: "blocked",
        message: "Google redirected Flow to the Labs home page. The signed-in account or current region does not have Flow access.",
      };
    }
    if (await isFlowMarketingLandingPage(page)) {
      return {
        state: "blocked",
        message: "Google returned the Flow marketing page instead of the project workspace.",
      };
    }
    const unsupportedVisible = await page.getByText(/Flow is not available in your country/i)
      .isVisible()
      .catch(() => false);
    if (url.includes("/unsupported-country") || unsupportedVisible) {
      return { state: "blocked", message: "Google Flow показывает видимую блокировку региона для этого локального агента." };
    }
    if (options.requireWorkspace) {
      const promptVisible = await page.locator('[data-testid="prompt"], textarea, [contenteditable="true"]')
        .first()
        .isVisible()
        .catch(() => false);
      if (!promptVisible || !/\/tools\/flow\/project\//i.test(url)) {
        return { state: "error", message: "Google Flow ещё не показал рабочее поле проекта; задания остаются в очереди." };
      }
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

async function processJob(context: BrowserContext, job: AgentJob, preferredPage?: Page | null) {
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
  const prompt = await resolveJobPrompt(job, products, context);
  const originalAnchors = new Map<"front" | "back", string>();
  let frontDesignSeedPath: string | undefined;
  let winnerLabelOverlayPath: string | undefined;
  if (job.mode === "original-design" && job.preserveWinnerLabel) {
    const labelReferencePath = path.join(jobDirectory, "winner-neck-label-reference.png");
    winnerLabelOverlayPath = path.join(jobDirectory, "winner-neck-label-overlay.png");
    await createBestLabelAssets([...products.values()], labelReferencePath, winnerLabelOverlayPath);
    console.log(`[flow-agent] ${job.id}: exact winner neck label prepared.`);
  }
  const persistedProjectUrl = job.mode === "original-design"
    ? await readFile(flowProjectStatePath, "utf8").then((value) => value.trim()).catch(() => "")
    : "";
  let originalProjectUrl = job.mode === "original-design"
    ? context.pages().map((candidate) => candidate.url()).find((url) => /\/tools\/flow\/project\//i.test(url))
      || (/\/tools\/flow\/project\//i.test(persistedProjectUrl) ? persistedProjectUrl : undefined)
    : undefined;
  if (job.mode === "original-design") {
    console.log(`[flow-agent] ${job.id}: project page ${preferredPage?.url() || "none"}; saved project ${originalProjectUrl || "none"}`);
  }
  if (job.mode === "original-design") {
    for (const [slot, side] of [["1", "front"], ["2", "back"]] as const) {
      const result = job.results.find((item) => item.productIndex === 1 && item.backgroundSlot === slot);
      if (!result) continue;
      const target = path.join(jobDirectory, `anchor-${side}.png`);
      await downloadAsset(job.id, "results", result.fileName || `product-01-background-${slot}.png`, target);
      originalAnchors.set(side, target);
    }
  }
  let cursor = 0;
  let activeModelIndex = 0;
  const failures: string[] = [];
  const workers = Array.from({ length: Math.min(job.mode === "original-design" ? 1 : concurrency, work.length) }, async (_, workerIndex) => {
    let page = job.mode === "original-design" && workerIndex === 0 && preferredPage && !preferredPage.isClosed()
      ? preferredPage
      : await context.newPage();
    const shouldClosePage = page !== preferredPage;
    try {
      while (cursor < work.length) {
        const item = work[cursor++];
        try {
          const outputPath = path.join(jobDirectory, `product-${String(item.product.index).padStart(2, "0")}-background-${item.background.slot}.png`);
          const sourceProductPath = products.get(item.product.index)!;
          const backgroundPath = backgrounds.get(item.background.slot)!;
          const backgroundMetadata = await sharp(backgroundPath).metadata();
          const backgroundWidth = backgroundMetadata.width || 0;
          const backgroundHeight = backgroundMetadata.height || 0;
          const aspectRatio = inferFlowImageAspectRatio(backgroundWidth, backgroundHeight);
          const canvasLock = `OUTPUT CANVAS LOCK: use ${aspectRatio} and preserve the SCENE reference image's ${backgroundWidth}x${backgroundHeight} orientation, crop, perspective and composition. Never rotate, widen, extend or replace its background.`;
          const garmentLayoutLock = "PRODUCT LAYOUT LOCK: show one fully unfolded flat short-sleeve T-shirt at natural full-frame scale. Collar, entire hem and both complete sleeves must be visible; the garment must occupy roughly 75-85% of frame height. Never fold, stack, roll, crop, hang or turn it into a sweatshirt.";
          // The approved CRM photo is the immutable scene reference. A generated
          // "empty plate" can silently replace the quilt/bed with another surface
          // and then teach QA that the wrong background is correct.
          const sceneBackgroundPath = backgroundPath;
          if (job.mode === "original-design") {
            console.log(`[flow-agent] ${job.id} ${item.product.index}/${item.background.slot}: использует исходный утверждённый фон без промежуточной генерации.`);
          }
          const originalStage = job.mode === "original-design" ? originalDesignStage(item.background.slot) : null;
          if (originalStage === "front-anchor" && !frontDesignSeedPath) {
            frontDesignSeedPath = path.join(jobDirectory, "front-design-seed.png");
            console.log(`[flow-agent] ${job.id}: generating a clean front design seed before applying the approved CRM scene.`);
            await withProgressLog(
              generateFlowImage({
                page,
                flowUrl: originalProjectUrl || flowUrl,
                references: [],
                prompt: buildOriginalFrontSeedPrompt(prompt),
                outputPath: frontDesignSeedPath,
                timeoutMs: generationTimeoutMs,
                maxOutputEdge: job.imageSize === "4K" ? 4096 : 2048,
                downloadResolution: "2K",
                model: FLOW_IMAGE_MODELS[activeModelIndex],
                aspectRatio,
              }),
              job.id,
              item.product.index,
              item.background.slot,
              FLOW_IMAGE_MODELS[activeModelIndex],
            );
            if (/\/tools\/flow\/project\//i.test(page.url())) {
              originalProjectUrl = page.url();
              await writeFile(flowProjectStatePath, originalProjectUrl, "utf8");
            }
          }
          const anchorProductPath = originalStage === "front-photo" || originalStage === "front-detail"
            ? requireAnchor(originalAnchors, "front")
            : originalStage === "back-photo" ? requireAnchor(originalAnchors, "back") : undefined;
          const productPath = anchorProductPath || sourceProductPath;
          const references = job.mode !== "original-design"
            ? [productPath, backgroundPath]
            : originalStage === "front-anchor"
              ? [frontDesignSeedPath!, backgroundPath]
              : originalStage === "back-anchor"
                ? [requireAnchor(originalAnchors, "front"), sceneBackgroundPath]
                : [productPath, sceneBackgroundPath];
          const requiresProductQa = job.mode !== "original-design" || originalStage === "front-photo" || originalStage === "front-detail" || originalStage === "back-photo";
          const requiresOriginalAnchorQa = originalStage === "front-anchor";
          const requiresDesignPairQa = originalStage === "back-anchor";
          const sceneReferenceNumber = originalStage === "front-anchor" ? 1 : 2;
          const angleDirection = originalStage === "front-detail"
            ? "DETAIL VARIANT: move the real camera closer and lower for an oblique three-quarter product photograph. Keep the entire print, collar, at least one complete sleeve, a garment edge and surrounding scene visible."
            : flowAngleDirection(item.background.slot).replace("IMAGE 2", `IMAGE ${sceneReferenceNumber}`);
          const stageLayoutLock = originalStage === "front-detail"
            ? "PRODUCT DETAIL LOCK: this is a genuine close product photograph, never a digital crop or texture-only macro. The complete print occupies 35-50% of frame, while enough shirt silhouette and background remain visible to prove a real camera angle."
            : garmentLayoutLock;
          const baseGenerationPrompt = job.mode === "original-design"
            ? `${canvasLock} ${stageLayoutLock} ${angleDirection} ${buildOriginalStagePrompt(originalStage!, prompt, 1, { preserveWinnerLabel: job.preserveWinnerLabel, designReference: originalStage === "front-anchor" })}`
            : `${canvasLock} ${angleDirection} ${prompt}`;
          let feedback = "";
          for (let attempt = 1; attempt <= (requiresProductQa || requiresOriginalAnchorQa || requiresDesignPairQa ? qualityMaxAttempts : 1); attempt += 1) {
            let timing: Awaited<ReturnType<typeof generateFlowImage>> | undefined;
            let usedModel: FlowImageModel = FLOW_IMAGE_MODELS[activeModelIndex];
            let generationAttempt = 1;
            while (generationAttempt <= generationMaxAttempts) {
              const activeModel = FLOW_IMAGE_MODELS[activeModelIndex];
              usedModel = activeModel;
              try {
                if (job.mode === "original-design") {
                  console.log(`[flow-agent] ${job.id} ${item.product.index}/${item.background.slot}: page before generation ${page.url()}; target ${originalProjectUrl || flowUrl}`);
                }
                timing = await withProgressLog(
                  generateFlowImage({
                    page,
                    flowUrl: originalProjectUrl || flowUrl,
                    references,
                    prompt: feedback
                      ? `CRITICAL RETRY: ${feedback} ${baseGenerationPrompt}`
                      : baseGenerationPrompt,
                    outputPath,
                    timeoutMs: generationTimeoutMs,
                    maxOutputEdge: job.imageSize === "4K" ? 4096 : 2048,
                    downloadResolution: "2K",
                    model: activeModel,
                    aspectRatio,
                  }),
                  job.id,
                  item.product.index,
                  item.background.slot,
                  activeModel,
                );
                if (/\/tools\/flow\/project\//i.test(page.url())) {
                  originalProjectUrl = page.url();
                  await writeFile(flowProjectStatePath, originalProjectUrl, "utf8");
                }
                break;
              } catch (error) {
                if (error instanceof FlowModelLimitError) {
                  if (activeModelIndex >= FLOW_IMAGE_MODELS.length - 1) {
                    throw new Error("Flow: дневной лимит исчерпан у Nano Banana Pro, Nano Banana 2 и Nano Banana 2 Lite.");
                  }
                  const previousModel = FLOW_IMAGE_MODELS[activeModelIndex];
                  activeModelIndex += 1;
                  console.warn(`[flow-agent] ${job.id}: лимит ${previousModel}; переключаюсь на ${FLOW_IMAGE_MODELS[activeModelIndex]}.`);
                  if (job.mode === "original-design") {
                    await delay(1_500);
                  } else {
                    await page.close().catch(() => undefined);
                    page = await context.newPage();
                  }
                  continue;
                }
                if (!isRetryableGenerationError(error) || generationAttempt === generationMaxAttempts) throw error;
                const reason = sanitizeFlowAgentError(error);
                console.warn(
                  `[flow-agent] ${job.id} ${item.product.index}/${item.background.slot}: Flow retry ${generationAttempt}/${generationMaxAttempts}: ${reason}`,
                );
                if (/Flow generation failed: Flow showed a retryable generation error/i.test(reason)
                  && activeModelIndex < FLOW_IMAGE_MODELS.length - 1) {
                  const previousModel = FLOW_IMAGE_MODELS[activeModelIndex];
                  activeModelIndex += 1;
                  console.warn(
                    `[flow-agent] ${job.id}: ${previousModel} returned a generic error; switching to ${FLOW_IMAGE_MODELS[activeModelIndex]}.`,
                  );
                }
                if (job.mode === "original-design"
                  && generationAttempt >= 2
                  && /Flow generation failed: Flow showed a retryable generation error/i.test(reason)) {
                  console.warn(`[flow-agent] ${job.id}: repeated generic errors in the saved Flow project; rotating to a clean project in the same signed-in Chrome profile.`);
                  await writeFile(flowProjectStatePath, "", "utf8");
                  originalProjectUrl = undefined;
                  activeModelIndex = 0;
                  await page.goto(flowUrl, { waitUntil: "domcontentloaded", timeout: 45_000 });
                  await delay(1_000);
                }
                await delay(Math.min(2_000 * generationAttempt, 6_000));
                if (job.mode !== "original-design" || /рабочая область не загрузилась/i.test(reason)) {
                  await page.close().catch(() => undefined);
                  page = await context.newPage();
                  if (job.mode === "original-design" && originalProjectUrl) {
                    await page.goto(originalProjectUrl, { waitUntil: "domcontentloaded", timeout: 45_000 });
                  }
                } else if (originalProjectUrl && page.url() !== originalProjectUrl) {
                  await page.goto(originalProjectUrl, { waitUntil: "domcontentloaded", timeout: 45_000 });
                }
                generationAttempt += 1;
              }
            }
            if (!timing) throw new Error(`Flow generation failed for ${item.product.index}/${item.background.slot}.`);
            if (winnerLabelOverlayPath && originalStage !== "back-anchor" && originalStage !== "back-photo") {
              const labelTarget = await requestLabelTarget(job.id, outputPath);
              await applyExactLabelOverlay(outputPath, winnerLabelOverlayPath, labelTarget);
            }
            let verdict: FlowPhotoQualityVerdict & { provider?: string };
            const candidateMetadata = await sharp(outputPath).metadata();
            const geometry = compareFlowImageGeometry(
              { width: backgroundWidth, height: backgroundHeight },
              { width: candidateMetadata.width || 0, height: candidateMetadata.height || 0 },
            );
            const watermarkRisk = geometry.pass ? await evaluateCornerWatermarkRisk(outputPath) : null;
            if (!geometry.pass) {
              verdict = { pass: false, score: 0, issues: [geometry.issue], provider: "geometry" };
            } else if (watermarkRisk && !watermarkRisk.pass) {
              verdict = { ...watermarkRisk, provider: "local-watermark-gate" };
            } else if ((originalStage === "front-photo" || originalStage === "front-detail" || originalStage === "back-photo") && anchorProductPath) {
              const diversity = await evaluateShotDiversity(anchorProductPath, outputPath);
              if (!diversity.pass) {
                verdict = { pass: false, score: 0, issues: [diversity.issue!], provider: "shot-diversity" };
              } else {
                try {
                  verdict = await evaluateFlowProductPhoto(
                    {
                      productPath,
                      backgroundPath: sceneBackgroundPath,
                      candidatePath: outputPath,
                      ...(originalStage === "front-detail" ? { composition: "detail" as const } : {}),
                    },
                    { fetchFn: browserPageFetch(page), retryRateLimits: false },
                  );
                  verdict.provider = "identity-and-composition";
                } catch (error) {
                  console.warn(
                    `[flow-agent] ${job.id} ${item.product.index}/${item.background.slot}: final-photo QA unavailable, using Claude: ${sanitizeFlowAgentError(error)}`,
                  );
                  try {
                    verdict = await requestFallbackQuality(job.id, productPath, sceneBackgroundPath, outputPath);
                    verdict.provider = "claude-fallback";
                  } catch (fallbackError) {
                    console.warn(
                      `[flow-agent] ${job.id} ${item.product.index}/${item.background.slot}: final-photo QA providers unavailable, keeping candidate for manual review: ${sanitizeFlowAgentError(fallbackError)}`,
                    );
                    verdict = {
                      pass: true,
                      score: 0,
                      issues: ["Final-photo QA unavailable; manual review required."],
                      skipped: true,
                      provider: "manual-review",
                    };
                  }
                }
              }
            } else if (requiresOriginalAnchorQa) {
              const printPresence = await evaluateCentralPrintPresence(outputPath);
              if (!printPresence.pass) {
                verdict = { ...printPresence, provider: "local-print-presence" };
              } else {
              try {
                verdict = await evaluateFlowOriginalDesignAnchor(
                  {
                    candidatePath: outputPath,
                    sourcePaths: job.products.map((product) => products.get(product.index)!),
                    side: "front",
                    designBrief: prompt,
                    preserveWinnerLabel: job.preserveWinnerLabel,
                    scenePath: sceneBackgroundPath,
                  },
                  { fetchFn: browserPageFetch(page) },
                );
              } catch (error) {
                console.warn(
                  `[flow-agent] ${job.id} ${item.product.index}/${item.background.slot}: original-design QA unavailable, keeping candidate for manual review: ${sanitizeFlowAgentError(error)}`,
                );
                verdict = {
                  pass: true,
                  score: 0,
                  issues: ["Original-design QA unavailable; manual review required."],
                  skipped: true,
                  provider: "manual-review",
                };
              }
              }
            } else if (requiresDesignPairQa) {
              const printPresence = await evaluateCentralPrintPresence(outputPath);
              if (!printPresence.pass) {
                verdict = { ...printPresence, provider: "local-print-presence" };
              } else {
              try {
                verdict = await evaluateFlowOriginalDesignPair(
                  {
                    frontPath: requireAnchor(originalAnchors, "front"),
                    backPath: outputPath,
                    sourcePaths: job.products.map((product) => products.get(product.index)!),
                    designBrief: prompt,
                    preserveWinnerLabel: job.preserveWinnerLabel,
                    scenePath: sceneBackgroundPath,
                  },
                  { fetchFn: browserPageFetch(page) },
                );
              } catch (error) {
                console.warn(
                  `[flow-agent] ${job.id} ${item.product.index}/${item.background.slot}: design-pair QA unavailable, keeping candidate for manual review: ${sanitizeFlowAgentError(error)}`,
                );
                verdict = {
                  pass: true,
                  score: 0,
                  issues: ["Design-pair QA unavailable; manual review required."],
                  skipped: true,
                  provider: "manual-review",
                };
              }
              }
            } else if (requiresProductQa) {
              try {
                verdict = await evaluateFlowProductPhoto(
                  { productPath, backgroundPath, candidatePath: outputPath },
                  { fetchFn: browserPageFetch(page), retryRateLimits: false },
                );
              } catch (error) {
                console.warn(
                  `[flow-agent] ${job.id} ${item.product.index}/${item.background.slot}: Gemini QA unavailable, using Claude: ${sanitizeFlowAgentError(error)}`,
                );
                try {
                  verdict = await requestFallbackQuality(job.id, productPath, backgroundPath, outputPath);
                } catch (fallbackError) {
                  console.warn(
                    `[flow-agent] ${job.id} ${item.product.index}/${item.background.slot}: QA providers unavailable, keeping candidate for manual review: ${sanitizeFlowAgentError(fallbackError)}`,
                  );
                  verdict = {
                    pass: true,
                    score: 0,
                    issues: ["External QA unavailable; manual review required."],
                    skipped: true,
                    provider: "manual-review",
                  };
                }
              }
            } else {
              verdict = { pass: true, score: 100, issues: [], skipped: true };
            }
            if (verdict.pass) {
              await uploadResult(job.id, item.product.index, item.background.slot, outputPath, timing, job.imageSize);
              if (originalStage === "front-anchor") originalAnchors.set("front", outputPath);
              if (originalStage === "back-anchor") originalAnchors.set("back", outputPath);
              console.log(`[flow-agent] ${job.id} ${item.product.index}/${item.background.slot}: ${(timing.durationMs / 1000).toFixed(1)} сек; ${usedModel}; QA ${verdict.skipped ? "skipped" : verdict.score}${verdict.provider ? ` (${verdict.provider})` : ""}`);
              break;
            }
            feedback = verdict.issues.join("; ").slice(0, 320) || `product fidelity score was ${verdict.score}/100`;
            console.warn(`[flow-agent] ${job.id} ${item.product.index}/${item.background.slot}: QA ${verdict.score}, retry ${attempt}/${qualityMaxAttempts}: ${feedback}`);
            if (attempt === qualityMaxAttempts) {
              throw new Error(`Flow QA rejected ${item.product.index}/${item.background.slot} after ${qualityMaxAttempts} attempts: ${feedback}`);
            }
          }
        } catch (error) {
          const reason = sanitizeFlowAgentError(error);
          if (job.mode === "original-design") {
            throw new Error(`${item.product.index}/${item.background.slot}: ${reason}`, { cause: error });
          }
          failures.push(`${item.product.index}/${item.background.slot}: ${reason}`);
          console.error(`[flow-agent] ${job.id} ${item.product.index}/${item.background.slot}: ${reason}; продолжаю остальные фото.`);
        }
      }
    } finally {
      if (shouldClosePage) await page.close();
    }
  });
  const outcomes = await Promise.allSettled(workers);
  const failed = outcomes.find((outcome): outcome is PromiseRejectedResult => outcome.status === "rejected");
  if (failed) throw failed.reason;
  if (failures.length) throw new Error(`Flow не завершил ${failures.length} фото: ${failures.join(" | ")}`);
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
    "workspace did not load",
    "рабочая область не загрузилась",
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

function originalDesignStage(slot: BackgroundSlot): OriginalDesignStage {
  return ({
    "1": "front-anchor",
    "2": "back-anchor",
    "3": "front-detail",
    "4": "back-photo",
  } as const)[slot];
}

function requireAnchor(anchors: Map<"front" | "back", string>, side: "front" | "back") {
  const anchor = anchors.get(side);
  if (!anchor) throw new Error(`Flow: не создан опорный ${side === "front" ? "передний" : "задний"} вид нового изделия.`);
  return anchor;
}

async function withProgressLog<T>(
  operation: Promise<T>,
  jobId: string,
  productIndex: number,
  backgroundSlot: BackgroundSlot,
  model: FlowImageModel,
) {
  const started = Date.now();
  const timer = setInterval(() => {
    console.log(`[flow-agent] ${jobId} ${productIndex}/${backgroundSlot}: ${model} работает, ${Math.round((Date.now() - started) / 1_000)} сек.`);
  }, 30_000);
  try {
    return await operation;
  } finally {
    clearInterval(timer);
  }
}

async function resolveJobPrompt(job: AgentJob, products: Map<number, string>, context: BrowserContext) {
  if (job.mode !== "original-design") return job.generationPrompt || defaultPrompt();
  if (isApprovedContentMachineDesignPrompt(job.designPrompt)) return job.designPrompt!;
  if (job.designPrompt) console.warn(`[flow-agent] ${job.id}: cached design brief failed the current adult-streetwear taste lock; regenerating it.`);
  let designPage: Page | undefined;
  let visionFetch: typeof fetch | undefined;
  try {
    designPage = await context.newPage();
    await designPage.goto(flowUrl, { waitUntil: "domcontentloaded", timeout: 45_000 });
    visionFetch = browserPageFetch(designPage);
  } catch (error) {
    await designPage?.close().catch(() => undefined);
    designPage = undefined;
    console.warn(`[flow-agent] Browser-backed design analysis unavailable: ${error instanceof Error ? error.message : String(error)}`);
  }
  let research = isVisualResearchReady(job.marketResearch) ? job.marketResearch : undefined;
  if (!research) {
    let query = job.inspirationQuery?.trim();
    if (!query) throw new Error("Для режима нового дизайна не задан рыночный запрос.");
    try {
      const winner = await withStageProgress(job.id, "анализирует бренд победителя", inferWinnerMarketQuery(
          job.products.map((product) => products.get(product.index)!),
          query,
          visionFetch ? { fetchFn: visionFetch } : {},
        ));
      query = winner.query;
      console.log(`[flow-agent] ${job.id}: winner brand analysis — ${winner.brand}, ${winner.garmentType}; market query "${query}".`);
    } catch (error) {
      console.warn(`[flow-agent] Winner brand analysis failed, using user query: ${error instanceof Error ? error.message : String(error)}`);
    }
    let browser: Browser | null = null;
    try {
      browser = await chromium.launch({
        channel: "chrome",
        headless: process.env.FLOW_RESEARCH_HEADLESS === "1",
      });
      research = await withStageProgress(job.id, "сравнивает Grailed, Mercari и Rakuma", collectMarketResearch(browser, query));
    } finally {
      await browser?.close();
    }
    await saveResearch(job.id, research);
  }
  try {
    const generated = await withStageProgress(job.id, "собирает производственный дизайн-бриф Gemini", createGeminiApparelDesignPrompt({
      sourcePaths: job.products.map((product) => products.get(product.index)!),
      research,
      designNote: job.designNote,
      labelStyleReference: job.labelStyleReference,
    }, visionFetch ? { fetchFn: visionFetch } : {}));
    console.log(`[flow-agent] ${job.id}: Gemini analyzed winner + ${generated.visualReferenceCount} marketplace images; concept ${generated.brief.conceptName}.`);
    await saveMetaPrompt(job.id, generated.prompt, "gemini");
    await designPage?.close().catch(() => undefined);
    return generated.prompt;
  } catch (error) {
    console.warn(`[flow-agent] Gemini visual design brief failed, asking CRM meta-prompt: ${error instanceof Error ? error.message : String(error)}`);
  }
  try {
    const generated = await withStageProgress(job.id, "собирает резервный дизайн-бриф Claude", createClaudeApparelDesignPrompt({
      sourcePaths: job.products.map((product) => products.get(product.index)!),
      research,
      designNote: job.designNote,
      labelStyleReference: job.labelStyleReference,
    }));
    console.log(`[flow-agent] ${job.id}: Claude analyzed winner + ${generated.visualReferenceCount} marketplace images; concept ${generated.brief.conceptName}.`);
    await saveMetaPrompt(job.id, generated.prompt, "claude");
    await designPage?.close().catch(() => undefined);
    return generated.prompt;
  } catch (error) {
    console.warn(`[flow-agent] Claude visual design brief failed, asking CRM meta-prompt: ${error instanceof Error ? error.message : String(error)}`);
  }
  try {
    const prompt = await requestMetaPrompt(job.id);
    if (!prompt.includes("32") || !isApprovedContentMachineDesignPrompt(prompt)) {
      throw new Error("CRM meta-prompt is missing the production/taste lock or contains a banned merch motif.");
    }
    await designPage?.close().catch(() => undefined);
    return prompt;
  } catch (error) {
    console.warn(`[flow-agent] CRM meta-prompt failed, using production fallback: ${error instanceof Error ? error.message : String(error)}`);
    const prompt = buildOriginalDesignPrompt(research, job.designNote, job.labelStyleReference, job.products.length);
    await saveMetaPrompt(job.id, prompt, "fallback").catch(() => undefined);
    await designPage?.close().catch(() => undefined);
    return prompt;
  }
}

function isVisualResearchReady(research?: MarketResearch) {
  if (!research) return false;
  const visualCount = research.listings.filter((listing) => Boolean(listing.imageUrl)).length;
  return visualCount >= 6 && Object.values(research.sourceCounts).every((count) => count > 0);
}

async function withStageProgress<T>(jobId: string, stage: string, operation: Promise<T>) {
  const started = Date.now();
  console.log(`[flow-agent] ${jobId}: ${stage}…`);
  const timer = setInterval(() => {
    console.log(`[flow-agent] ${jobId}: ${stage}, ${Math.round((Date.now() - started) / 1_000)} сек.`);
  }, 15_000);
  try {
    return await operation;
  } finally {
    clearInterval(timer);
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

async function saveMetaPrompt(jobId: string, prompt: string, source: "gemini" | "claude" | "fallback") {
  const response = await agentFetch(`/api/ai/content-machine/flow-agent/jobs/${jobId}/meta-prompt`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ agentId, prompt, source }),
  });
  if (!response.ok) throw new Error(`CRM did not save the ${source} design brief: HTTP ${response.status} ${await response.text()}`);
}

async function downloadAsset(jobId: string, kind: string, fileName: string, target: string) {
  const response = await agentFetch(`/api/ai/content-machine/flow-agent/jobs/${jobId}/asset/${kind}/${encodeURIComponent(fileName)}`);
  if (!response.ok) throw new Error(`Не удалось скачать ${fileName}: HTTP ${response.status}.`);
  await writeFile(target, Buffer.from(await response.arrayBuffer()));
}

async function requestLabelTarget(jobId: string, candidatePath: string): Promise<NeckLabelTarget> {
  const source = await readFile(candidatePath);
  const form = new FormData();
  form.set("file", new Blob([new Uint8Array(source)], { type: "image/png" }), path.basename(candidatePath));
  const response = await agentFetch(`/api/ai/content-machine/flow-agent/jobs/${jobId}/label-target`, {
    method: "POST",
    body: form,
  });
  const data = await response.json() as { target?: NeckLabelTarget; error?: string };
  if (!response.ok || !data.target) {
    throw new Error(data.error || `CRM could not locate the inside neck-label panel: HTTP ${response.status}.`);
  }
  return data.target;
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
  const route = `/api/ai/content-machine/flow-agent/jobs/${jobId}/result`;
  let lastError = "unknown upload error";
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      const response = await agentFetch(route, { method: "POST", body: form });
      const raw = await response.text();
      if (!response.ok) throw new Error(`HTTP ${response.status} ${raw}`);
      const data = JSON.parse(raw) as { job?: { results?: Array<{ productIndex: number; backgroundSlot: BackgroundSlot }> } };
      const stored = data.job?.results?.some((result) =>
        result.productIndex === productIndex && result.backgroundSlot === backgroundSlot,
      );
      if (!stored) throw new Error("CRM response did not confirm the uploaded result slot");
      return;
    } catch (error) {
      lastError = sanitizeFlowAgentError(error);
      if (attempt === 4) break;
      console.warn(`[flow-agent] ${jobId} ${productIndex}/${backgroundSlot}: result upload retry ${attempt}/4: ${lastError}`);
      await delay(attempt * 1_500);
    }
  }
  throw new Error(`CRM did not persist result ${productIndex}/${backgroundSlot} after 4 attempts: ${lastError}`);
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

async function requestFallbackQuality(jobId: string, productPath: string, backgroundPath: string, candidatePath: string) {
  const form = new FormData();
  form.set("product", new Blob([new Uint8Array(await readFile(productPath))], { type: "image/jpeg" }), path.basename(productPath));
  form.set("background", new Blob([new Uint8Array(await readFile(backgroundPath))], { type: "image/jpeg" }), path.basename(backgroundPath));
  form.set("candidate", new Blob([new Uint8Array(await readFile(candidatePath))], { type: "image/png" }), path.basename(candidatePath));
  const response = await agentFetch(`/api/ai/content-machine/flow-agent/jobs/${jobId}/quality`, { method: "POST", body: form });
  const data = await response.json() as (FlowPhotoQualityVerdict & { provider?: string; error?: string });
  if (!response.ok) throw new Error(data.error || `Claude QA вернула HTTP ${response.status}.`);
  return data;
}

async function supervise() {
  while (true) {
    try {
      await main();
      return;
    } catch (error) {
      const message = sanitizeFlowAgentError(error);
      console.error(`[flow-agent] session stopped: ${message}`);
      if (process.env.FLOW_AGENT_PREFLIGHT === "1") {
        process.exit(1);
      }
      await reportStatus({
        state: "error",
        message: "Локальный Flow-агент перезапускается после ошибки.",
      }).catch(() => undefined);
      await delay(3_000);
    }
  }
}

void supervise();
