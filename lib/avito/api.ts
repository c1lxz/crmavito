type TokenCache = { token: string; expiresAt: number } | null;

let tokenCache: TokenCache = null;

async function getAvitoToken(): Promise<string | null> {
  const clientId = process.env.AVITO_CLIENT_ID;
  const clientSecret = process.env.AVITO_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    console.warn("[avito] AVITO_CLIENT_ID or AVITO_CLIENT_SECRET not set");
    return null;
  }

  if (tokenCache && tokenCache.expiresAt > Date.now() + 60_000) {
    return tokenCache.token;
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
      console.error(`[avito] token failed: HTTP ${r.status}`);
      return null;
    }
    const data = (await r.json()) as { access_token?: string; expires_in?: number };
    if (!data.access_token) return null;
    tokenCache = {
      token: data.access_token,
      expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000,
    };
    return data.access_token;
  } catch (e) {
    console.error("[avito] token error", e);
    return null;
  }
}

const IMAGE_RE = /^https?:\/\/[^\s"']+\.(?:jpg|jpeg|png|webp)(?:\?[^\s"']*)?$/i;

function findFirstImageUrl(value: unknown, depth = 0): string | null {
  if (depth > 6 || value == null) return null;
  if (typeof value === "string") return IMAGE_RE.test(value) ? value : null;
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

export async function fetchAvitoItemImage(avitoItemId: string): Promise<string | null> {
  const token = await getAvitoToken();
  if (!token) return null;

  const tryEndpoints = [
    `https://api.avito.ru/core/v1/items/${avitoItemId}/`,
    `https://api.avito.ru/core/v1/items?ids=${avitoItemId}`,
  ];

  for (const url of tryEndpoints) {
    try {
      const r = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
        signal: AbortSignal.timeout(10000),
      });
      if (!r.ok) continue;
      const data = (await r.json()) as unknown;
      const img = findFirstImageUrl(data);
      if (img) return img;
    } catch (e) {
      console.warn(`[avito] item fetch failed ${url}`, e);
    }
  }
  return null;
}
