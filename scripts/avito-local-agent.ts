import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { analyzeAvitoMarket, buildAvitoSearchUrl, formatAvitoMarketError, parseAvitoHtml } from "@/lib/avito/market-analysis";

const HOST = process.env.AVITO_LOCAL_AGENT_HOST ?? "127.0.0.1";
const PORT = Number(process.env.AVITO_LOCAL_AGENT_PORT ?? 3217);
const USE_BROWSER = process.env.AVITO_LOCAL_AGENT_BROWSER === "1";
const BROWSER_PROFILE_DIR = process.env.AVITO_LOCAL_AGENT_PROFILE_DIR ?? ".avito-local-browser";

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
    const response = await page.goto(requestedUrl, { waitUntil: "domcontentloaded", timeout: 45000 });

    if (await page.locator("text=/Доступ ограничен|Продолжить|captcha/i").first().isVisible().catch(() => false)) {
      console.log("Avito access check is visible. Complete it in the opened browser window.");
      await page.waitForFunction(
        () => !/Доступ ограничен|captcha/i.test(document.body?.innerText ?? ""),
        undefined,
        { timeout: 120000 },
      ).catch(() => undefined);
    }

    await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => undefined);
    const html = await page.content();
    const probe = parseAvitoHtml(html, {
      requestedUrl,
      finalUrl: page.url(),
      status: response?.status() ?? 0,
      ok: response?.ok() ?? false,
      contentType: response?.headers()["content-type"] ?? "text/html",
      category: input.category.trim(),
      periodDays: input.periodDays,
    });
    return {
      ...probe,
      listings: [],
      summary: {
        checked: probe.listingPreviews.length,
        withViews: 0,
        totalViews: 0,
        averageViews: null,
        maxViews: null,
      },
    };
  } finally {
    await context.close();
  }
}
