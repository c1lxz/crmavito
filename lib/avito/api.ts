type TokenCache = { token: string; expiresAt: number } | null;

let tokenCache: TokenCache = null;
let accountIdCache: string | null = null;

export function __resetAvitoTokenCacheForTests() {
  tokenCache = null;
  accountIdCache = null;
}

export type AvitoResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: string };

async function getAvitoToken(): Promise<AvitoResult<string>> {
  const clientId = process.env.AVITO_CLIENT_ID;
  const clientSecret = process.env.AVITO_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return { ok: false, reason: "Avito credentials не настроены" };
  }

  if (tokenCache && tokenCache.expiresAt > Date.now() + 60_000) {
    return { ok: true, value: tokenCache.token };
  }

  try {
    const r = await fetch("https://api.avito.ru/token/", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: clientId,
        client_secret: clientSecret,
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(10000),
    });
    if (!r.ok) {
      const body = await r.text().catch(() => "");
      console.error(`[avito] token HTTP ${r.status}: ${body.slice(0, 200)}`);
      return { ok: false, reason: `Avito auth HTTP ${r.status}` };
    }
    const data = (await r.json()) as { access_token?: string; expires_in?: number };
    if (!data.access_token) {
      return { ok: false, reason: "Avito не вернул access_token" };
    }
    tokenCache = {
      token: data.access_token,
      expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000,
    };
    return { ok: true, value: data.access_token };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[avito] token error", msg);
    return { ok: false, reason: `Avito auth error: ${msg.slice(0, 80)}` };
  }
}

async function getAccountId(token: string): Promise<string | null> {
  if (accountIdCache) return accountIdCache;
  try {
    const r = await fetch("https://api.avito.ru/core/v1/accounts/self", {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) {
      console.warn(`[avito] accounts/self HTTP ${r.status}`);
      return null;
    }
    const data = (await r.json()) as { id?: number | string };
    if (data.id == null) return null;
    accountIdCache = String(data.id);
    return accountIdCache;
  } catch (e) {
    console.warn("[avito] accounts/self error", e);
    return null;
  }
}

const IMAGE_EXT_RE = /\.(?:jpg|jpeg|png|webp|gif)(?:\?|#|$)/i;
const AVITO_CDN_RE = /^https?:\/\/[^\s"'<>]*avito\.st\/[^\s"'<>]+/i;

export function isLikelyImageUrl(s: string): boolean {
  if (!s.startsWith("http")) return false;
  if (IMAGE_EXT_RE.test(s)) return true;
  if (AVITO_CDN_RE.test(s)) return true;
  return false;
}

export function findFirstImageUrl(value: unknown, depth = 0): string | null {
  if (depth > 8 || value == null) return null;
  if (typeof value === "string") return isLikelyImageUrl(value) ? value : null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findFirstImageUrl(item, depth + 1);
      if (found) return found;
    }
    return null;
  }
  if (typeof value === "object") {
    for (const key of Object.keys(value as Record<string, unknown>)) {
      const found = findFirstImageUrl((value as Record<string, unknown>)[key], depth + 1);
      if (found) return found;
    }
  }
  return null;
}

async function tryEndpoint(url: string, token: string): Promise<{
  found?: string;
  reason: string;
}> {
  try {
    const r = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
      signal: AbortSignal.timeout(10000),
    });
    if (!r.ok) {
      const body = await r.text().catch(() => "");
      console.warn(`[avito] ${url} HTTP ${r.status}: ${body.slice(0, 150)}`);
      return { reason: `Avito API HTTP ${r.status}` };
    }
    const data = (await r.json()) as unknown;
    const img = findFirstImageUrl(data);
    if (img) return { found: img, reason: "" };
    if (data && typeof data === "object") {
      console.warn(
        `[avito] no image at ${url}, top keys:`,
        Object.keys(data as Record<string, unknown>).join(", ")
      );
    }
    return { reason: "В ответе Avito нет фото" };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(`[avito] ${url} error: ${msg}`);
    return { reason: `Avito error: ${msg.slice(0, 60)}` };
  }
}

export async function fetchAvitoItemImage(
  avitoItemId: string
): Promise<AvitoResult<string>> {
  const token = await getAvitoToken();
  if (!token.ok) return token;

  let lastReason = "Avito не вернул фото";

  // Шаг 1: короткие endpoint'ы /core/v1/items/{id}
  for (const url of [
    `https://api.avito.ru/core/v1/items/${avitoItemId}/`,
    `https://api.avito.ru/core/v1/items/${avitoItemId}`,
  ]) {
    const res = await tryEndpoint(url, token.value);
    if (res.found) return { ok: true, value: res.found };
    lastReason = res.reason;
  }

  // Шаг 2: получаем account_id и пробуем /core/v1/accounts/{id}/items/{itemId}
  const accountId = await getAccountId(token.value);
  if (accountId) {
    for (const url of [
      `https://api.avito.ru/core/v1/accounts/${accountId}/items/${avitoItemId}/`,
      `https://api.avito.ru/core/v1/accounts/${accountId}/items/${avitoItemId}`,
    ]) {
      const res = await tryEndpoint(url, token.value);
      if (res.found) return { ok: true, value: res.found };
      lastReason = res.reason;
    }
  }

  return { ok: false, reason: lastReason };
}
