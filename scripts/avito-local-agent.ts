import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  analyzeAvitoMarket,
  buildAvitoSearchUrl,
  extractAvitoListingPreviews,
  formatAvitoMarketError,
  parseAvitoHtml,
  parseAvitoListingDetails,
  type AvitoListingPreview,
} from "@/lib/avito/market-analysis";

loadLocalEnv();

const HOST = process.env.AVITO_LOCAL_AGENT_HOST ?? "127.0.0.1";
const PORT = clampNumber(process.env.AVITO_LOCAL_AGENT_PORT, 1, 65535, 3217);
const USE_BROWSER = process.env.AVITO_LOCAL_AGENT_BROWSER === "1";
const BROWSER_PROFILE_DIR = process.env.AVITO_LOCAL_AGENT_PROFILE_DIR ?? ".avito-local-browser";
const BROWSER_MAX_LISTINGS = clampNumber(process.env.AVITO_LOCAL_AGENT_MAX_LISTINGS, 1, 200, 200);
const BROWSER_DETAIL_DELAY_MS = clampNumber(process.env.AVITO_LOCAL_AGENT_DETAIL_DELAY_MS, 0, 10000, 500);
const BROWSER_SEARCH_PAGES = clampNumber(process.env.AVITO_LOCAL_AGENT_SEARCH_PAGES, 1, 20, 10);
const ACCESS_CHECK_TIMEOUT_MS = clampNumber(process.env.AVITO_LOCAL_AGENT_ACCESS_TIMEOUT_MS, 30000, 900000, 600000);
const PROGRESS_DIR = process.env.AVITO_LOCAL_AGENT_PROGRESS_DIR ?? ".avito-local-agent";
const CAPTCHA_TELEGRAM_CHAT_ID = process.env.AVITO_LOCAL_AGENT_CAPTCHA_TELEGRAM_CHAT_ID ?? "@itneurobusiness";
const SKIP_USED_OR_WHOLESALE_NOTE = "Skipped: wholesale or used listing";

type BrowserListingDetail = ReturnType<typeof parseAvitoListingDetails>;

type BrowserRunState = {
  requestedUrl: string;
  category: string;
  periodDays: number;
  listingPreviews: AvitoListingPreview[];
  listings: BrowserListingDetail[];
  updatedAt: string;
};

type JsonResponse = {
  status: number;
  body: unknown;
};

function sendJson(res: ServerResponse, response: JsonResponse) {
  res.writeHead(response.status, {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "content-type",
    "access-control-allow-private-network": "true",
    "content-type": "application/json; charset=utf-8",
  });
  res.end(JSON.stringify(response.body));
}

async function readJson(req: IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    sendJson(res, { status: 204, body: null });
    return;
  }

  if (req.method === "GET" && req.url === "/health") {
    sendJson(res, { status: 200, body: { ok: true, service: "avito-local-agent" } });
    return;
  }

  if (req.method !== "POST" || req.url !== "/api/avito/market-analysis/probe") {
    sendJson(res, { status: 404, body: { error: "Not found" } });
    return;
  }

  try {
    const body = await readJson(req);
    const category = typeof body.category === "string" ? body.category : "";
    const periodDays = Number(body.periodDays ?? 3);

    if (!category.trim() || !Number.isFinite(periodDays)) {
      sendJson(res, { status: 400, body: { error: "Укажите категорию и период." } });
      return;
    }

    const result = USE_BROWSER
      ? await probeWithBrowser({ category, periodDays })
      : await analyzeAvitoMarket({ category, periodDays }, { timeoutMs: 20000 });
    sendJson(res, {
      status: 200,
      body: {
        ...result,
        notes: [
          USE_BROWSER
            ? "Запрос выполнен локальным браузерным агентом на этом компьютере."
            : "Запрос выполнен локальным агентом на этом компьютере.",
          ...result.notes,
        ],
      },
    });
  } catch (error) {
    sendJson(res, { status: 502, body: { error: formatAvitoMarketError(error) } });
  }
}).listen(PORT, HOST, () => {
  console.log(`Avito local agent listening on http://${HOST}:${PORT}`);
  if (USE_BROWSER) {
    console.log(`Browser mode enabled. Profile: ${BROWSER_PROFILE_DIR}`);
    console.log(`Browser mode will collect up to ${BROWSER_MAX_LISTINGS} listings.`);
  }
});

async function probeWithBrowser(input: { category: string; periodDays: number }) {
  const { chromium } = await import("playwright");
  const requestedUrl = buildAvitoSearchUrl(input.category);
  const progress = createProgressStore(input, requestedUrl);
  const savedState = await loadBrowserRunState(progress);
  const context = await chromium.launchPersistentContext(BROWSER_PROFILE_DIR, {
    channel: process.env.AVITO_LOCAL_AGENT_BROWSER_CHANNEL || undefined,
    headless: process.env.AVITO_LOCAL_AGENT_HEADLESS === "1",
    viewport: { width: 1366, height: 900 },
    locale: "ru-RU",
  });

  try {
    const page = context.pages()[0] ?? (await context.newPage());
    const search = savedState?.listingPreviews.length
      ? {
          listingPreviews: savedState.listingPreviews,
          probe: parseAvitoHtml("", {
            requestedUrl,
            finalUrl: requestedUrl,
            status: 200,
            ok: true,
            contentType: "text/html",
          }),
        }
      : await collectSearchPreviews(page, requestedUrl);
    await saveBrowserRunState(progress, {
      requestedUrl,
      category: input.category,
      periodDays: input.periodDays,
      listingPreviews: search.listingPreviews,
      listings: savedState?.listings ?? [],
      updatedAt: new Date().toISOString(),
    });
    const listings = await collectListingDetails(page, search.listingPreviews, progress, input, requestedUrl, savedState?.listings ?? []);
    const skippedListings = listings.filter((item) => item.note === SKIP_USED_OR_WHOLESALE_NOTE);
    const analyzedListings = listings.filter((item) => item.note !== SKIP_USED_OR_WHOLESALE_NOTE);
    const recentListings = analyzedListings.filter((item) => item.ageDays == null || item.ageDays <= input.periodDays);
    const views = recentListings.flatMap((item) => (item.views == null ? [] : [item.views]));
    const totalViews = views.reduce((sum, value) => sum + value, 0);

    return {
      ...search.probe,
      listingPreviews: search.listingPreviews,
      notes: [
        ...search.probe.notes,
        savedState?.listings.length
          ? `Browser agent resumed previous progress: ${savedState.listings.length} listing page(s) were already checked.`
          : "Browser agent started a new collection run.",
        "Browser agent skips wholesale and used listings.",
        `Browser agent collected listings: ${search.listingPreviews.length}. Checked listing pages: ${analyzedListings.length}. Skipped wholesale/used: ${skippedListings.length}. Listings with visible views: ${views.length}.`,
      ],
      listings: recentListings.sort((a, b) => (b.views ?? -1) - (a.views ?? -1)),
      summary: {
        checked: analyzedListings.length,
        withViews: views.length,
        totalViews,
        averageViews: views.length ? Math.round(totalViews / views.length) : null,
        maxViews: views.length ? Math.max(...views) : null,
      },
    };
  } finally {
    await context.close();
  }
}

async function collectSearchPreviews(page: import("playwright").Page, requestedUrl: string) {
  const seen = new Set<string>();
  const listingPreviews: AvitoListingPreview[] = [];
  let firstHtml = "";
  let firstUrl = requestedUrl;
  let firstStatus = 0;
  let firstOk = false;
  let firstContentType = "text/html";

  for (let pageIndex = 1; pageIndex <= BROWSER_SEARCH_PAGES && listingPreviews.length < BROWSER_MAX_LISTINGS; pageIndex++) {
    const response = await page.goto(withPageParam(requestedUrl, pageIndex), {
      waitUntil: "domcontentloaded",
      timeout: 45000,
    });
    await waitForAccessCheck(page);
    await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => undefined);

    const html = await page.content();
    if (pageIndex === 1) {
      firstHtml = html;
      firstUrl = page.url();
      firstStatus = response?.status() ?? 0;
      firstOk = response?.ok() ?? false;
      firstContentType = response?.headers()["content-type"] ?? "text/html";
    }

    const before = listingPreviews.length;
    const pagePreviews = await extractBrowserListingPreviews(page, BROWSER_MAX_LISTINGS);
    const previews = pagePreviews.length > 0
      ? pagePreviews
      : extractAvitoListingPreviews(html, page.url(), BROWSER_MAX_LISTINGS);
    for (const preview of previews) {
      const key = preview.id ?? preview.url;
      if (seen.has(key)) continue;
      seen.add(key);
      listingPreviews.push(preview);
      if (listingPreviews.length >= BROWSER_MAX_LISTINGS) break;
    }
    if (listingPreviews.length === before) break;
  }

  return {
    listingPreviews,
    probe: parseAvitoHtml(firstHtml, {
      requestedUrl,
      finalUrl: firstUrl,
      status: firstStatus,
      ok: firstOk,
      contentType: firstContentType,
    }),
  };
}

async function collectListingDetails(
  page: import("playwright").Page,
  previews: AvitoListingPreview[],
  progress: ReturnType<typeof createProgressStore>,
  input: { category: string; periodDays: number },
  requestedUrl: string,
  initialListings: BrowserListingDetail[],
) {
  const listings = [...initialListings];
  const checkedUrls = new Set(listings.map((item) => item.url).filter(Boolean));
  for (const [index, preview] of previews.slice(0, BROWSER_MAX_LISTINGS).entries()) {
    if (checkedUrls.has(preview.url)) continue;
    if (index > 0 && BROWSER_DETAIL_DELAY_MS) await wait(BROWSER_DETAIL_DELAY_MS + Math.round(Math.random() * BROWSER_DETAIL_DELAY_MS));
    try {
      const response = await page.goto(preview.url, { waitUntil: "domcontentloaded", timeout: 45000 });
      await waitForAccessCheck(page);
      await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => undefined);
      const html = await page.content();
      if (isUsedOrWholesaleText(html)) {
        listings.push({
          id: preview.id,
          url: page.url() || preview.url,
          title: null,
          views: null,
          publishedAt: null,
          ageDays: null,
          status: response?.status() ?? 0,
          ok: false,
          note: SKIP_USED_OR_WHOLESALE_NOTE,
        });
        await saveBrowserRunState(progress, {
          requestedUrl,
          category: input.category,
          periodDays: input.periodDays,
          listingPreviews: previews,
          listings,
          updatedAt: new Date().toISOString(),
        });
        continue;
      }

      listings.push(parseAvitoListingDetails(preview, html, {
        finalUrl: page.url(),
        status: response?.status() ?? 0,
        ok: response?.ok() ?? false,
      }));
      await saveBrowserRunState(progress, {
        requestedUrl,
        category: input.category,
        periodDays: input.periodDays,
        listingPreviews: previews,
        listings,
        updatedAt: new Date().toISOString(),
      });
    } catch (error) {
      if (isAvitoAccessCheckError(error)) throw error;
      listings.push({
        id: preview.id,
        url: preview.url,
        title: null,
        views: null,
        publishedAt: null,
        ageDays: null,
        status: 0,
        ok: false,
        note: error instanceof Error ? error.message : String(error),
      });
      await saveBrowserRunState(progress, {
        requestedUrl,
        category: input.category,
        periodDays: input.periodDays,
        listingPreviews: previews,
        listings,
        updatedAt: new Date().toISOString(),
      });
    }
  }
  return listings;
}

async function extractBrowserListingPreviews(page: import("playwright").Page, limit: number): Promise<AvitoListingPreview[]> {
  const rawItems = await page
    .locator("a[href*='_']")
    .evaluateAll((anchors, maxItems) => {
      const output: Array<{ href: string; text: string }> = [];
      const seen = new Set<string>();

      for (const anchor of anchors) {
        if (output.length >= Number(maxItems)) break;
        const link = anchor as HTMLAnchorElement;
        const href = link.href || link.getAttribute("href") || "";
        if (!/_\d{6,}/.test(href) || seen.has(href)) continue;
        seen.add(href);

        const textRoot =
          link.closest("[data-marker='item'], [data-marker='item-title'], [itemtype*='Product'], article, div") ??
          link.parentElement ??
          link;
        output.push({
          href,
          text: (textRoot.textContent || link.textContent || "").replace(/\s+/g, " ").trim(),
        });
      }

      return output;
    }, limit)
    .catch(() => []);

  return rawItems
    .filter((item) => !isUsedOrWholesaleText(item.text))
    .map((item) => ({
      id: item.href.match(/_(\d{6,})(?:\?|$)/)?.[1] ?? null,
      url: item.href,
    }));
}

function isUsedOrWholesaleText(value: string) {
  const text = value
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .toLowerCase();

  return /(^|[\s,.;:()[\]{}"'«»/-])(б\/у|бу|б\.у\.|б у|с пробегом|после носки|ношен[аоы]?|секонд|second hand|used|опт|оптом|оптов|мелкий опт|крупный опт)(?=$|[\s,.;:()[\]{}"'«»/-])/.test(text);
}

async function waitForAccessCheck(page: import("playwright").Page) {
  if (!(await isAvitoAccessCheckVisible(page))) return;

  await page.bringToFront().catch(() => undefined);
  await notifyCaptchaRequired(page);
  console.log(
    [
      "Avito access check is visible.",
      "Click Continue and complete the captcha manually in the opened browser window.",
      `Waiting up to ${Math.round(ACCESS_CHECK_TIMEOUT_MS / 1000)} seconds before continuing.`,
    ].join(" "),
  );

  const startedAt = Date.now();
  while (Date.now() - startedAt < ACCESS_CHECK_TIMEOUT_MS) {
    if (!(await isAvitoAccessCheckVisible(page))) {
      await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => undefined);
      return;
    }
    await wait(1000);
  }

  throw new Error(
    "Avito access check was not completed in the local browser. Click Continue, solve the captcha, then run the check again.",
  );
}

function isAvitoAccessCheckError(error: unknown) {
  return error instanceof Error && error.message.startsWith("Avito access check was not completed");
}

async function isAvitoAccessCheckVisible(page: import("playwright").Page) {
  const bodyText = await page.locator("body").innerText({ timeout: 2000 }).catch(() => "");
  if (/Доступ ограничен|проблема с IP|Продолжить|решения капчи|captcha/i.test(bodyText)) return true;

  return page
    .locator("#h-captcha, #inner-captcha, #geetest_captcha, .h-captcha, [name='captcha-response']")
    .first()
    .isVisible({ timeout: 1000 })
    .catch(() => false);
}

function createProgressStore(input: { category: string; periodDays: number }, requestedUrl: string) {
  const key = createHash("sha1")
    .update(JSON.stringify({ category: input.category.trim().toLowerCase(), periodDays: input.periodDays, requestedUrl }))
    .digest("hex")
    .slice(0, 16);

  return {
    key,
    file: path.join(PROGRESS_DIR, "market-analysis", `${key}.json`),
  };
}

async function loadBrowserRunState(progress: ReturnType<typeof createProgressStore>): Promise<BrowserRunState | null> {
  try {
    const state = JSON.parse(await readFile(progress.file, "utf8")) as BrowserRunState;
    if (!Array.isArray(state.listingPreviews) || !Array.isArray(state.listings)) return null;
    return state;
  } catch {
    return null;
  }
}

async function saveBrowserRunState(progress: ReturnType<typeof createProgressStore>, state: BrowserRunState) {
  await mkdir(path.dirname(progress.file), { recursive: true });
  await writeFile(progress.file, JSON.stringify(state, null, 2), "utf8");
}

async function notifyCaptchaRequired(page: import("playwright").Page) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token || !CAPTCHA_TELEGRAM_CHAT_ID) return;

  try {
    const screenshot = await page.screenshot({ fullPage: false, type: "png" });
    const form = new FormData();
    form.set("chat_id", CAPTCHA_TELEGRAM_CHAT_ID);
    form.set(
      "caption",
      [
        "Avito просит пройти капчу на ПК.",
        "Откройте локальное окно Chromium агента, нажмите Продолжить и решите проверку.",
        "После этого сбор продолжится с сохраненного места.",
      ].join("\n"),
    );
    const image = screenshot.buffer.slice(
      screenshot.byteOffset,
      screenshot.byteOffset + screenshot.byteLength,
    ) as ArrayBuffer;
    form.set("photo", new Blob([image], { type: "image/png" }), "avito-captcha.png");

    const response = await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, {
      method: "POST",
      body: form,
    });
    if (!response.ok) {
      console.warn(`Telegram captcha notification failed: HTTP ${response.status} ${await response.text()}`);
    }
  } catch (error) {
    console.warn(`Telegram captcha notification failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function withPageParam(rawUrl: string, page: number): string {
  if (page <= 1) return rawUrl;
  const url = new URL(rawUrl);
  url.searchParams.set("p", String(page));
  return url.toString();
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function clampNumber(value: string | undefined, min: number, max: number, fallback: number) {
  const number = Number(value ?? fallback);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.round(number)));
}

function loadLocalEnv() {
  const envPath = path.resolve(process.cwd(), ".env");
  if (!existsSync(envPath)) return;

  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match || process.env[match[1]] != null) continue;
    process.env[match[1]] = match[2].trim().replace(/^(['"])(.*)\1$/, "$2");
  }
}
