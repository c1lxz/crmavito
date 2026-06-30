import { fetchAvitoItemImage, isLikelyImageUrl, type AvitoResult } from "./api";
import { readFile } from "node:fs/promises";
import path from "node:path";

function decodeHtmlValue(value: string): string {
  return value
    .replace(/\\u002F/gi, "/")
    .replace(/\\\//g, "/")
    .replace(/&amp;/gi, "&")
    .replace(/&#x2F;/gi, "/")
    .replace(/&#47;/g, "/")
    .trim();
}

function normalizeAvitoImageCandidate(value: string): string | null {
  const decoded = decodeHtmlValue(value).replace(/^\/\//, "https://");
  try {
    const url = new URL(decoded);
    return isLikelyImageUrl(url.toString()) ? url.toString() : null;
  } catch {
    return null;
  }
}

export function pickAvitoImage(html: string): string | null {
  const isJunk = (u: string) => /icons?\/|touch-icon|favicon|logo|sprite|\/dstatic\/build\//i.test(u);
  const candidates: string[] = [];
  const decodedHtml = decodeHtmlValue(html);

  function add(value: string | undefined) {
    if (!value) return;
    for (const part of value.split(",")) {
      const src = part.trim().split(/\s+/)[0];
      if (src) candidates.push(src);
    }
  }

  const ogTags = html.matchAll(
    /<meta\s[^>]*property=["']og:image(?::secure_url|:url)?["'][^>]*>/gi
  );
  for (const tag of ogTags) {
    add(tag[0].match(/content=["']([^"']+)["']/i)?.[1]);
  }

  const twTag = html.match(/<meta\s[^>]*(?:name|property)=["']twitter:image["'][^>]*>/i);
  add(twTag?.[0].match(/content=["']([^"']+)["']/i)?.[1]);

  for (const attr of html.matchAll(/\b(?:src|data-src|data-image|content)=["']([^"']+)["']/gi)) {
    add(attr[1]);
  }

  for (const attr of html.matchAll(/\bsrcset=["']([^"']+)["']/gi)) {
    add(attr[1]);
  }

  for (const source of [html, decodedHtml]) {
    for (const m of source.matchAll(/(?:https?:)?\\?\/\\?\/[^"'\s<>\\]*(?:img\.)?avito\.st\/[^"'\s<>\\]+/gi)) {
      add(m[0]);
    }
  }

  for (const m of decodedHtml.matchAll(/https?:\/\/[^"'\s<>]*(?:img\.)?avito\.st\/[^"'\s<>]+/gi)) {
    add(m[0]);
  }

  for (const candidate of candidates) {
    const normalized = normalizeAvitoImageCandidate(candidate);
    if (normalized && !isJunk(normalized)) return normalized;
  }

  return null;
}

async function scrapeListingHtml(listingUrl: string): Promise<AvitoResult<string>> {
  try {
    const r = await fetch(listingUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept-Language": "ru-RU,ru;q=0.9",
        Accept: "text/html",
      },
      signal: AbortSignal.timeout(10000),
    });
    if (!r.ok) {
      console.warn(`[avito] listing fetch ${listingUrl} HTTP ${r.status}`);
      return { ok: false, reason: `HTML scrape HTTP ${r.status}` };
    }
    const html = await r.text();
    const img = pickAvitoImage(html);
    if (img) return { ok: true, value: img };
    return { ok: false, reason: "В HTML страницы нет фото (вероятно captcha)" };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn("[avito] listing fetch error", msg);
    return { ok: false, reason: `HTML scrape error: ${msg.slice(0, 60)}` };
  }
}

export interface ProductImageSource {
  avitoItemId?: string | null;
  avitoListingUrl?: string | null;
}

export async function resolveProductImage(
  p: ProductImageSource
): Promise<AvitoResult<string>> {
  const reasons: string[] = [];
  if (p.avitoItemId) {
    const fromApi = await fetchAvitoItemImage(p.avitoItemId);
    if (fromApi.ok) return fromApi;
    reasons.push(`API: ${fromApi.reason}`);
  } else {
    reasons.push("API: нет avitoItemId");
  }
  if (p.avitoListingUrl) {
    const fromHtml = await scrapeListingHtml(p.avitoListingUrl);
    if (fromHtml.ok) return fromHtml;
    reasons.push(`HTML: ${fromHtml.reason}`);
  } else {
    reasons.push("HTML: нет avitoListingUrl");
  }
  return { ok: false, reason: reasons.join(" | ") };
}

export async function downloadImageAsBuffer(url: string): Promise<Buffer | null> {
  try {
    if (url.startsWith("/uploads/")) {
      const publicRoot = path.resolve(process.cwd(), "public");
      const filePath = path.resolve(publicRoot, `.${url}`);
      if (!filePath.startsWith(`${publicRoot}${path.sep}`)) return null;
      return await readFile(filePath);
    }
    const r = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Referer: "https://www.avito.ru/",
        Accept: "image/avif,image/webp,image/png,image/jpeg,*/*",
      },
      signal: AbortSignal.timeout(15000),
    });
    if (!r.ok) {
      console.warn(`[avito] image download ${url} HTTP ${r.status}`);
      return null;
    }
    const ab = await r.arrayBuffer();
    return Buffer.from(ab);
  } catch (e) {
    console.warn("[avito] image download error", e);
    return null;
  }
}
