import { findBotvImageByTitle } from "@/lib/botv/avito-image-cache";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { ProxyAgent } from "undici";
import { fetchAvitoItemImage, isLikelyImageUrl, type AvitoResult } from "./api";

type ProxyFetchInit = RequestInit & { dispatcher?: ProxyAgent };

const HTML_BLOCK_COOLDOWN_MS = 10 * 60 * 1000;
const htmlBlockedUntilByUrl = new Map<string, { status: number; until: number }>();
let cachedProxyUrl: string | null = null;
let cachedProxyAgent: ProxyAgent | null = null;

function getAvitoHtmlProxyUrl(): string | null {
  const raw = (process.env.AVITO_IMAGE_PROXY_URL || process.env.AVITO_MARKET_PROXY_URL)?.trim();
  if (!raw) return null;

  const schemeMatch = raw.match(/^(https?):\/\/(.+)$/i);
  if (schemeMatch) {
    const [, scheme, rest] = schemeMatch;
    const at = rest.lastIndexOf("@");
    if (at === -1) return raw;

    const auth = rest.slice(0, at);
    const hostPort = rest.slice(at + 1);
    const authSeparator = auth.indexOf(":");
    const portSeparator = hostPort.lastIndexOf(":");
    if (authSeparator === -1 || portSeparator === -1) return raw;

    const username = auth.slice(0, authSeparator);
    const password = auth.slice(authSeparator + 1);
    const host = hostPort.slice(0, portSeparator);
    const port = hostPort.slice(portSeparator + 1);
    return `${scheme.toLowerCase()}://${encodeURIComponent(username)}:${encodeURIComponent(password)}@${host}:${port}`;
  }

  const parts = raw.split(":");
  if (parts.length !== 4) return raw;

  const [host, port, username, password] = parts;
  return `http://${encodeURIComponent(username)}:${encodeURIComponent(password)}@${host}:${port}`;
}

function withAvitoHtmlProxy(init: RequestInit): RequestInit {
  const proxyUrl = getAvitoHtmlProxyUrl();
  if (!proxyUrl) return init;

  if (cachedProxyUrl !== proxyUrl) {
    cachedProxyUrl = proxyUrl;
    cachedProxyAgent = new ProxyAgent(proxyUrl);
  }

  return { ...init, dispatcher: cachedProxyAgent ?? undefined } as ProxyFetchInit;
}

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
    /<meta\s[^>]*property=["']og:image(?::secure_url|:url)?["'][^>]*>/gi,
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

export async function fetchAvitoListingImage(listingUrl: string): Promise<AvitoResult<string>> {
  const blocked = htmlBlockedUntilByUrl.get(listingUrl);
  if (blocked && blocked.until > Date.now()) {
    const waitSeconds = Math.ceil((blocked.until - Date.now()) / 1000);
    return {
      ok: false,
      reason: `HTML scrape blocked by Avito HTTP ${blocked.status}; wait ${waitSeconds}s`,
    };
  }
  if (blocked) htmlBlockedUntilByUrl.delete(listingUrl);

  try {
    const response = await fetch(
      listingUrl,
      withAvitoHtmlProxy({
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
          "Accept-Language": "ru-RU,ru;q=0.9,en;q=0.8",
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Cache-Control": "no-cache",
        },
        redirect: "follow",
        cache: "no-store",
        signal: AbortSignal.timeout(15_000),
      }),
    );

    if (!response.ok) {
      console.warn(`[avito] listing fetch ${listingUrl} HTTP ${response.status}`);
      if (response.status === 429 || response.status === 439) {
        htmlBlockedUntilByUrl.set(listingUrl, {
          status: response.status,
          until: Date.now() + HTML_BLOCK_COOLDOWN_MS,
        });
      }
      return { ok: false, reason: `HTML scrape HTTP ${response.status}` };
    }

    const html = await response.text();
    const image = pickAvitoImage(html);
    if (image) return { ok: true, value: image };
    return { ok: false, reason: "В HTML страницы нет фото (вероятно captcha)" };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const cause = error instanceof Error && error.cause instanceof Error ? `: ${error.cause.message}` : "";
    console.warn("[avito] listing fetch error", `${message}${cause}`);
    return { ok: false, reason: `HTML scrape error: ${`${message}${cause}`.slice(0, 80)}` };
  }
}

export interface ProductImageSource {
  name?: string | null;
  avitoItemId?: string | null;
  avitoListingUrl?: string | null;
}

export async function resolveProductImage(p: ProductImageSource): Promise<AvitoResult<string>> {
  const reasons: string[] = [];

  if (p.avitoListingUrl) {
    const fromHtml = await fetchAvitoListingImage(p.avitoListingUrl);
    if (fromHtml.ok) return fromHtml;
    reasons.push(`HTML: ${fromHtml.reason}`);
  } else {
    reasons.push("HTML: нет avitoListingUrl");
  }

  if (p.avitoItemId) {
    const fromApi = await fetchAvitoItemImage(p.avitoItemId);
    if (fromApi.ok) return fromApi;
    reasons.push(`API: ${fromApi.reason}`);
  } else {
    reasons.push("API: нет avitoItemId");
  }

  if (p.name) {
    const fromBotv = await findBotvImageByTitle(p.name);
    if (fromBotv) return { ok: true, value: fromBotv };
    reasons.push("BOTV: нет фото в XML");
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

    const response = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Referer: "https://www.avito.ru/",
        Accept: "image/avif,image/webp,image/png,image/jpeg,*/*",
      },
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) {
      console.warn(`[avito] image download ${url} HTTP ${response.status}`);
      return null;
    }
    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  } catch (error) {
    console.warn("[avito] image download error", error);
    return null;
  }
}
