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

type ProbeOptions = {
  fetchFn?: typeof fetch;
  timeoutMs?: number;
};

const DEFAULT_CITY_SLUG = "rossiya";
const DEFAULT_PERIOD_DAYS = 3;

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
    const response = await fetchFn(requestedUrl, {
      headers: {
        "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "accept-language": "ru-RU,ru;q=0.9,en;q=0.7",
        "cache-control": "no-cache",
        "user-agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
      },
      redirect: "follow",
      signal: controller.signal,
      cache: "no-store",
    });
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
