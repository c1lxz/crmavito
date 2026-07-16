import { ProxyAgent } from "undici";

export type AvitoProbeInput = {
  category: string;
  periodDays: number;
};

export type AvitoListingPreview = {
  id: string | null;
  url: string;
};

export type AvitoProbeResult = {
  requestedUrl: string;
  finalUrl: string;
  status: number;
  ok: boolean;
  contentType: string;
  bytes: number;
  fetchedAt: string;
  category: string;
  periodDays: number;
  pageTitle: string | null;
  pageType: "search" | "unknown";
  itemId: null;
  views: null;
  viewCandidates: string[];
  listingPreviews: AvitoListingPreview[];
  signals: {
    hasNextData: boolean;
    jsonScriptCount: number;
    likelyCaptcha: boolean;
    likelyJsRequired: boolean;
  };
  notes: string[];
};

export type AvitoAnalyzedListing = {
  id: string | null;
  url: string;
  title: string | null;
  views: number | null;
  publishedAt: string | null;
  ageDays: number | null;
  status: number;
  ok: boolean;
  note: string | null;
};

export type AvitoMarketAnalysisResult = AvitoProbeResult & {
  listings: AvitoAnalyzedListing[];
  summary: {
    checked: number;
    withViews: number;
    totalViews: number;
    averageViews: number | null;
    maxViews: number | null;
  };
};

type ProbeOptions = {
  fetchFn?: typeof fetch;
  timeoutMs?: number;
};

const DEFAULT_CITY_SLUG = "rossiya";
const DEFAULT_PERIOD_DAYS = 3;
const AVITO_HEADERS = {
  "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "accept-language": "ru-RU,ru;q=0.9,en;q=0.7",
  "cache-control": "no-cache",
  "user-agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
};

type ProxyFetchInit = RequestInit & { dispatcher?: ProxyAgent };

let cachedProxyUrl: string | null = null;
let cachedProxyAgent: ProxyAgent | null = null;

export function buildAvitoSearchUrl(category: string): string {
  const url = new URL(`https://www.avito.ru/${DEFAULT_CITY_SLUG}`);
  url.searchParams.set("q", category.trim());
  url.searchParams.set("s", "104");
  return url.toString();
}

export function normalizeAvitoProbeInput(input: AvitoProbeInput): string {
  if (!input.category.trim()) throw new Error("Введите категорию.");
  return buildAvitoSearchUrl(input.category);
}

export async function probeAvitoPublicPage(
  input: AvitoProbeInput,
  options: ProbeOptions = {},
): Promise<AvitoProbeResult> {
  const requestedUrl = normalizeAvitoProbeInput(input);
  const fetchFn = options.fetchFn ?? fetch;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 15000);

  try {
    const response = await fetchFn(
      requestedUrl,
      withMarketProxy(
        {
          headers: AVITO_HEADERS,
          redirect: "follow",
          signal: controller.signal,
          cache: "no-store",
        },
        fetchFn,
      ),
    );
    const html = await response.text();
    const contentType = response.headers.get("content-type") ?? "";
    return parseAvitoHtml(html, {
      requestedUrl,
      finalUrl: response.url || requestedUrl,
      status: response.status,
      ok: response.ok,
      contentType,
      category: input.category.trim(),
      periodDays: normalizePeriodDays(input.periodDays),
    });
  } finally {
    clearTimeout(timeout);
  }
}

export async function analyzeAvitoMarket(
  input: AvitoProbeInput,
  options: ProbeOptions & { maxListings?: number; delayMs?: number } = {},
): Promise<AvitoMarketAnalysisResult> {
  const fetchFn = options.fetchFn ?? fetch;
  const probe = await probeAvitoPublicPage(input, options);
  const maxListings = Math.min(Math.max(options.maxListings ?? 12, 1), 20);
  const delayMs = Math.max(options.delayMs ?? 350, 0);
  const listings: AvitoAnalyzedListing[] = [];

  for (const preview of probe.listingPreviews.slice(0, maxListings)) {
    if (delayMs && listings.length > 0) await wait(delayMs);
    listings.push(await fetchListingDetails(preview, fetchFn, options.timeoutMs ?? 15000));
  }

  const recentListings = listings.filter((item) => item.ageDays == null || item.ageDays <= probe.periodDays);
  const views = recentListings.flatMap((item) => (item.views == null ? [] : [item.views]));
  const totalViews = views.reduce((sum, value) => sum + value, 0);
  const notes = [...probe.notes];
  if (listings.length > 0) {
    notes.push(`Checked listings: ${listings.length}. Listings with visible views: ${views.length}.`);
  }
  if (getMarketProxyUrl()) {
    notes.push("Avito market requests used configured proxy.");
  }
  if (listings.length > 0 && views.length === 0) {
    notes.push("Avito did not expose listing view counters in the available public HTML.");
  }

  return {
    ...probe,
    notes,
    listings: recentListings.sort((a, b) => (b.views ?? -1) - (a.views ?? -1)),
    summary: {
      checked: listings.length,
      withViews: views.length,
      totalViews,
      averageViews: views.length ? Math.round(totalViews / views.length) : null,
      maxViews: views.length ? Math.max(...views) : null,
    },
  };
}

export function parseAvitoHtml(
  html: string,
  meta: Pick<AvitoProbeResult, "requestedUrl" | "finalUrl" | "status" | "ok" | "contentType"> &
    Partial<Pick<AvitoProbeResult, "category" | "periodDays">>,
): AvitoProbeResult {
  const pageTitle = extractTitle(html);
  const listingPreviews = extractListingPreviews(html, meta.finalUrl);
  const viewCandidates = extractViewCandidates(html);
  const hasNextData = /id=["']__NEXT_DATA__["']/.test(html);
  const jsonScriptCount = (html.match(/<script[^>]+type=["']application\/(?:ld\+)?json["']/gi) ?? []).length;
  const likelyCaptcha = /captcha|verify|доступ ограничен|подтвердите/i.test(html);
  const likelyJsRequired = listingPreviews.length === 0 && /enable javascript|включите javascript/i.test(html);
  const notes: string[] = [];

  if (likelyCaptcha) {
    notes.push("Авито вернул проверку доступа. Для стабильного сбора нужен аккуратный rate limit или браузерный сборщик.");
  }
  if (listingPreviews.length > 0) {
    notes.push(`В публичном HTML найдено объявлений: ${listingPreviews.length}.`);
  }
  if (hasNextData || jsonScriptCount > 0) {
    notes.push("На странице есть JSON-данные, их можно использовать как следующий слой сбора, если структура будет стабильной.");
  }
  if (notes.length === 0) {
    notes.push("Страница прочитана, но объявления в публичном HTML не найдены.");
  }

  return {
    ...meta,
    bytes: Buffer.byteLength(html, "utf8"),
    fetchedAt: new Date().toISOString(),
    category: meta.category ?? "",
    periodDays: normalizePeriodDays(meta.periodDays ?? DEFAULT_PERIOD_DAYS),
    pageTitle,
    pageType: listingPreviews.length > 0 ? "search" : "unknown",
    itemId: null,
    views: null,
    viewCandidates,
    listingPreviews,
    signals: {
      hasNextData,
      jsonScriptCount,
      likelyCaptcha,
      likelyJsRequired,
    },
    notes,
  };
}

function normalizePeriodDays(value: number): number {
  return Math.min(30, Math.max(1, Math.round(Number.isFinite(value) ? value : DEFAULT_PERIOD_DAYS)));
}

function isAvitoHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return host === "avito.ru" || host.endsWith(".avito.ru");
}

function extractTitle(html: string): string | null {
  const og = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i);
  const title = og?.[1] ?? html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  return title ? decodeHtml(title).trim().replace(/\s+/g, " ") : null;
}

function extractListingPreviews(html: string, finalUrl: string): AvitoListingPreview[] {
  const base = new URL(finalUrl);
  const seen = new Set<string>();
  const items: AvitoListingPreview[] = [];
  const regex = /href=["']([^"']*?_(\d{6,})(?:\?[^"']*)?)["']/gi;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(html)) && items.length < 20) {
    const href = decodeHtml(match[1]);
    if (/^https?:\/\//i.test(href) && !isAvitoHost(new URL(href).hostname)) continue;
    const url = new URL(href, base).toString();
    if (seen.has(url)) continue;
    seen.add(url);
    items.push({ id: match[2] ?? null, url });
  }

  return items;
}

function extractViewCandidates(html: string): string[] {
  const text = stripTags(html).replace(/\s+/g, " ");
  const seen = new Set<string>();
  const candidates: string[] = [];
  const regex = /(\d[\d\s\u00a0]{0,12})\s+(просмотр(?:ов|а)?|views?)/gi;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) && candidates.length < 10) {
    const value = match[0].trim();
    if (!seen.has(value)) {
      seen.add(value);
      candidates.push(value);
    }
  }

  return candidates;
}

async function fetchListingDetails(
  preview: AvitoListingPreview,
  fetchFn: typeof fetch,
  timeoutMs: number,
): Promise<AvitoAnalyzedListing> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchFn(
      preview.url,
      withMarketProxy(
        {
          headers: AVITO_HEADERS,
          redirect: "follow",
          signal: controller.signal,
          cache: "no-store",
        },
        fetchFn,
      ),
    );
    const html = await response.text();
    const publishedAt = extractPublishedAt(html);
    return {
      id: preview.id,
      url: response.url || preview.url,
      title: extractTitle(html),
      views: extractViews(html),
      publishedAt,
      ageDays: publishedAt ? daysSince(publishedAt) : null,
      status: response.status,
      ok: response.ok,
      note: response.ok ? null : `HTTP ${response.status}`,
    };
  } catch (error) {
    return {
      id: preview.id,
      url: preview.url,
      title: null,
      views: null,
      publishedAt: null,
      ageDays: null,
      status: 0,
      ok: false,
      note: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timeout);
  }
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function withMarketProxy(init: RequestInit, fetchFn: typeof fetch): RequestInit {
  if (fetchFn !== fetch) return init;

  const proxyUrl = getMarketProxyUrl();
  if (!proxyUrl) return init;

  if (cachedProxyUrl !== proxyUrl) {
    cachedProxyUrl = proxyUrl;
    cachedProxyAgent = new ProxyAgent(proxyUrl);
  }

  return { ...init, dispatcher: cachedProxyAgent ?? undefined } as ProxyFetchInit;
}

function getMarketProxyUrl(): string | null {
  const raw = process.env.AVITO_MARKET_PROXY_URL?.trim();
  if (!raw) return null;
  if (/^https?:\/\//i.test(raw)) return raw;

  const parts = raw.split(":");
  if (parts.length !== 4) return raw;

  const [host, port, username, password] = parts;
  return `http://${encodeURIComponent(username)}:${encodeURIComponent(password)}@${host}:${port}`;
}

function extractViews(html: string): number | null {
  const text = stripTags(html).replace(/\s+/g, " ");
  const match = text.match(/(\d[\d\s\u00a0]{0,12})\s+(?:\u043f\u0440\u043e\u0441\u043c\u043e\u0442\u0440(?:\u043e\u0432|\u0430)?|views?)/i);
  if (!match) return null;
  const value = Number(match[1].replace(/[^\d]/g, ""));
  return Number.isFinite(value) ? value : null;
}

function extractPublishedAt(html: string): string | null {
  const iso = html.match(/(?:datePublished|published_time|uploadDate)[^>]{0,120}?(\d{4}-\d{2}-\d{2})/i)?.[1];
  if (iso) return iso;
  const text = stripTags(html).replace(/\s+/g, " ").toLowerCase();
  const now = new Date();
  if (/\u0441\u0435\u0433\u043e\u0434\u043d\u044f/.test(text)) return now.toISOString().slice(0, 10);
  if (/\u0432\u0447\u0435\u0440\u0430/.test(text)) {
    const date = new Date(now);
    date.setDate(date.getDate() - 1);
    return date.toISOString().slice(0, 10);
  }
  const days = text.match(/(\d{1,2})\s+\u0434(?:\u0435\u043d\u044c|\u043d\u044f|\u043d\u0435\u0439)\s+\u043d\u0430\u0437\u0430\u0434/);
  if (days) {
    const date = new Date(now);
    date.setDate(date.getDate() - Number(days[1]));
    return date.toISOString().slice(0, 10);
  }
  return null;
}

function daysSince(dateText: string): number | null {
  const start = new Date(`${dateText}T00:00:00Z`).getTime();
  if (!Number.isFinite(start)) return null;
  return Math.max(0, Math.floor((Date.now() - start) / 86400000));
}

function stripTags(html: string): string {
  return decodeHtml(html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " "));
}

function decodeHtml(value: string): string {
  return value
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}
