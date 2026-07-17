import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import {
  analyzeAvitoMarket,
  buildAvitoSearchUrl,
  extractAvitoListingPreviews,
  formatAvitoMarketError,
  parseAvitoHtml,
  parseAvitoListingDetails,
  type AvitoListingPreview,
} from "@/lib/avito/market-analysis";

const HOST = process.env.AVITO_LOCAL_AGENT_HOST ?? "127.0.0.1";
const PORT = clampNumber(process.env.AVITO_LOCAL_AGENT_PORT, 1, 65535, 3217);
const USE_BROWSER = process.env.AVITO_LOCAL_AGENT_BROWSER === "1";
const BROWSER_PROFILE_DIR = process.env.AVITO_LOCAL_AGENT_PROFILE_DIR ?? ".avito-local-browser";
const BROWSER_MAX_LISTINGS = clampNumber(process.env.AVITO_LOCAL_AGENT_MAX_LISTINGS, 1, 200, 200);
const BROWSER_DETAIL_DELAY_MS = clampNumber(process.env.AVITO_LOCAL_AGENT_DETAIL_DELAY_MS, 0, 10000, 500);
const BROWSER_SEARCH_PAGES = clampNumber(process.env.AVITO_LOCAL_AGENT_SEARCH_PAGES, 1, 20, 10);

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
  const context = await chromium.launchPersistentContext(BROWSER_PROFILE_DIR, {
    channel: process.env.AVITO_LOCAL_AGENT_BROWSER_CHANNEL || undefined,
    headless: process.env.AVITO_LOCAL_AGENT_HEADLESS === "1",
    viewport: { width: 1366, height: 900 },
    locale: "ru-RU",
  });

  try {
    const page = context.pages()[0] ?? (await context.newPage());
    const search = await collectSearchPreviews(page, requestedUrl);
    const listings = await collectListingDetails(page, search.listingPreviews);
    const recentListings = listings.filter((item) => item.ageDays == null || item.ageDays <= input.periodDays);
    const views = recentListings.flatMap((item) => (item.views == null ? [] : [item.views]));
    const totalViews = views.reduce((sum, value) => sum + value, 0);

    return {
      ...search.probe,
      listingPreviews: search.listingPreviews,
      notes: [
        ...search.probe.notes,
        `Browser agent collected listings: ${search.listingPreviews.length}. Checked listing pages: ${listings.length}. Listings with visible views: ${views.length}.`,
      ],
      listings: recentListings.sort((a, b) => (b.views ?? -1) - (a.views ?? -1)),
      summary: {
        checked: listings.length,
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
    for (const preview of extractAvitoListingPreviews(html, page.url(), BROWSER_MAX_LISTINGS)) {
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

async function collectListingDetails(page: import("playwright").Page, previews: AvitoListingPreview[]) {
  const listings = [];
  for (const [index, preview] of previews.slice(0, BROWSER_MAX_LISTINGS).entries()) {
    if (index > 0 && BROWSER_DETAIL_DELAY_MS) await wait(BROWSER_DETAIL_DELAY_MS);
    try {
      const response = await page.goto(preview.url, { waitUntil: "domcontentloaded", timeout: 45000 });
      await waitForAccessCheck(page);
      await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => undefined);
      listings.push(parseAvitoListingDetails(preview, await page.content(), {
        finalUrl: page.url(),
        status: response?.status() ?? 0,
        ok: response?.ok() ?? false,
      }));
    } catch (error) {
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
    }
  }
  return listings;
}

async function waitForAccessCheck(page: import("playwright").Page) {
  const hasAccessCheck = await page
    .locator("text=/Доступ ограничен|Продолжить|captcha/i")
    .first()
    .isVisible()
    .catch(() => false);
  if (!hasAccessCheck) return;

  console.log("Avito access check is visible. Complete it in the opened browser window.");
  await page
    .waitForFunction(() => !/Доступ ограничен|captcha/i.test(document.body?.innerText ?? ""), undefined, {
      timeout: 120000,
    })
    .catch(() => undefined);
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
