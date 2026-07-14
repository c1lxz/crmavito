export type AvitoProbeInput =
  | { mode: "url"; url: string }
  | { mode: "search"; query: string; city?: string };

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
  pageTitle: string | null;
  pageType: "ad" | "search" | "unknown";
  itemId: string | null;
  views: number | null;
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

export function buildAvitoSearchUrl(query: string, city = DEFAULT_CITY_SLUG): string {
  const citySlug = normalizeCitySlug(city);
  const url = new URL(`https://www.avito.ru/${citySlug}`);
  url.searchParams.set("q", query.trim());
  return url.toString();
}

export function normalizeAvitoProbeInput(input: AvitoProbeInput): string {
  if (input.mode === "search") {
    if (!input.query.trim()) throw new Error("Введите поисковый запрос.");
    return buildAvitoSearchUrl(input.query, input.city);
  }

  const raw = input.url.trim();
  if (!raw) throw new Error("Введите ссылку Авито.");
  const withProtocol = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  const url = new URL(withProtocol);
  if (!isAvitoHost(url.hostname)) {
    throw new Error("Можно проверять только ссылки avito.ru.");
  }
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("Ссылка должна начинаться с http:// или https://.");
  }
  return url.toString();
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
    });
  } finally {
    clearTimeout(timeout);
  }
}

export function parseAvitoHtml(
  html: string,
  meta: Pick<AvitoProbeResult, "requestedUrl" | "finalUrl" | "status" | "ok" | "contentType">,
): AvitoProbeResult {
  const pageTitle = extractTitle(html);
  const itemId = extractItemId(meta.finalUrl, html);
  const listingPreviews = extractListingPreviews(html, meta.finalUrl);
  const viewCandidates = extractViewCandidates(html);
  const views = viewCandidates.length > 0 ? parseHumanNumber(viewCandidates[0]) : extractNumericViews(html);
  const hasNextData = /id=["']__NEXT_DATA__["']/.test(html);
  const jsonScriptCount = (html.match(/<script[^>]+type=["']application\/(?:ld\+)?json["']/gi) ?? []).length;
  const likelyCaptcha = /captcha|verify|доступ ограничен|подтвердите/i.test(html);
  const likelyJsRequired = listingPreviews.length === 0 && !itemId && /enable javascript|включите javascript/i.test(html);
  const pageType = itemId ? "ad" : listingPreviews.length > 0 ? "search" : "unknown";
  const notes: string[] = [];

  if (views === null) {
    notes.push("Счетчик просмотров не найден в публичном HTML. Возможно, Авито не показывает его чужим объявлениям или отдает через закрытый JS/API.");
  }
  if (likelyCaptcha) {
    notes.push("Похоже, Авито вернул проверку/ограничение доступа. Для стабильного сбора понадобится аккуратный rate limit или браузерный сборщик.");
  }
  if (listingPreviews.length > 0) {
    notes.push(`В HTML найдены ссылки на объявления: ${listingPreviews.length}. Это можно использовать как первый слой мониторинга выдачи.`);
  }
  if (hasNextData || jsonScriptCount > 0) {
    notes.push("На странице есть JSON-данные. Следующий шаг - изучить их структуру и брать поля оттуда, если Авито не меняет формат.");
  }

  return {
    ...meta,
    bytes: Buffer.byteLength(html, "utf8"),
    fetchedAt: new Date().toISOString(),
    pageTitle,
    pageType,
    itemId,
    views,
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

function normalizeCitySlug(city?: string): string {
  const value = (city || DEFAULT_CITY_SLUG).trim().toLowerCase();
  if (!value) return DEFAULT_CITY_SLUG;
  return value
    .replace(/^https?:\/\/(?:www\.)?avito\.ru\//, "")
    .replace(/[?#].*$/, "")
    .replace(/^\/+|\/+$/g, "")
    .replace(/[^a-z0-9_-]/g, "") || DEFAULT_CITY_SLUG;
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

function extractItemId(url: string, html: string): string | null {
  const fromUrl = url.match(/_(\d{6,})(?:[/?#]|$)/)?.[1];
  if (fromUrl) return fromUrl;
  return (
    html.match(/["']itemId["']\s*:\s*["']?(\d{6,})["']?/i)?.[1] ??
    html.match(/["']item_id["']\s*:\s*["']?(\d{6,})["']?/i)?.[1] ??
    null
  );
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

function extractNumericViews(html: string): number | null {
  const match =
    html.match(/["']views(?:Count)?["']\s*:\s*(\d+)/i) ??
    html.match(/["']totalViews["']\s*:\s*(\d+)/i);
  return match ? Number(match[1]) : null;
}

function parseHumanNumber(value: string): number {
  return Number(value.match(/\d[\d\s\u00a0]*/)?.[0].replace(/[\s\u00a0]/g, "") ?? 0);
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
