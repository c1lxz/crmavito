export function pickAvitoImage(html: string): string | null {
  const isJunk = (u: string) => /icons?\/|touch-icon|favicon|logo|sprite/i.test(u);

  const cdnMatches = html.matchAll(
    /https?:\/\/[^"'\s>]*avito\.st\/(?:image|stat|hi)[^"'\s>]*\.(?:jpg|jpeg|png|webp)/gi
  );
  for (const m of cdnMatches) {
    if (!isJunk(m[0])) return m[0];
  }

  const ogTags = html.matchAll(
    /<meta\s[^>]*property=["']og:image(?::secure_url|:url)?["'][^>]*>/gi
  );
  for (const tag of ogTags) {
    const content = tag[0].match(/content=["']([^"']+)["']/i)?.[1];
    if (content && !isJunk(content)) return content;
  }

  const twTag = html.match(/<meta\s[^>]*(?:name|property)=["']twitter:image["'][^>]*>/i);
  const content = twTag?.[0].match(/content=["']([^"']+)["']/i)?.[1];
  if (content && !isJunk(content)) return content;

  return null;
}

export async function fetchAvitoImageUrl(listingUrl: string): Promise<string | null> {
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
    if (!r.ok) return null;
    const html = await r.text();
    return pickAvitoImage(html);
  } catch {
    return null;
  }
}

export async function downloadImageAsBuffer(url: string): Promise<Buffer | null> {
  try {
    const r = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Referer: "https://www.avito.ru/",
        Accept: "image/avif,image/webp,image/png,image/jpeg,*/*",
      },
      signal: AbortSignal.timeout(15000),
    });
    if (!r.ok) return null;
    const ab = await r.arrayBuffer();
    return Buffer.from(ab);
  } catch {
    return null;
  }
}
