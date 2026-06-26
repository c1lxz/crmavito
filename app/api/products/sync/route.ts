import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db/prisma";

export const maxDuration = 300;

type AvitoListItem = {
  id: number;
  title: string;
  price: number;
  url: string;
  status: string;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function fetchWithRetry(url: string, headers: Record<string, string>, retries = 3): Promise<Response> {
  for (let i = 0; i < retries; i++) {
    const r = await fetch(url, { headers });
    if (r.status !== 429) return r;
    await sleep(500 * (i + 1));
  }
  return fetch(url, { headers });
}

async function processBatched<T, R>(items: T[], batchSize: number, delayMs: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = [];
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    const settled = await Promise.all(batch.map(fn));
    results.push(...settled);
    if (i + batchSize < items.length) await sleep(delayMs);
  }
  return results;
}

export async function POST(req: Request) {
  const cronSecret = process.env.CRON_SECRET;
  const headerSecret = req.headers.get("x-cron-secret");
  const isCron = cronSecret && headerSecret === cronSecret;

  if (!isCron) {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const clientId = process.env.AVITO_CLIENT_ID;
  const clientSecret = process.env.AVITO_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    return NextResponse.json({ error: "Avito API не настроен." }, { status: 503 });
  }

  try {
    const tokenRes = await fetch("https://api.avito.ru/token/", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "client_credentials", client_id: clientId, client_secret: clientSecret }),
    });
    if (!tokenRes.ok) {
      const body = await tokenRes.text();
      return NextResponse.json({ error: `Авторизация Avito: ${tokenRes.status} ${body.slice(0, 200)}` }, { status: 502 });
    }
    const { access_token } = await tokenRes.json() as { access_token: string };
    const authHeader = { Authorization: `Bearer ${access_token}` };

    const allItems: AvitoListItem[] = [];
    let page = 1;
    const perPage = 100;

    const statusCounts: Record<string, number> = {};
    while (true) {
      const listingsUrl = `https://api.avito.ru/core/v1/items?per_page=${perPage}&page=${page}`;
      const listingsRes = await fetchWithRetry(listingsUrl, authHeader);
      if (!listingsRes.ok) {
        const body = await listingsRes.text();
        return NextResponse.json({ error: `Получение списка (page ${page}): ${listingsRes.status} ${body.slice(0, 200)}` }, { status: 502 });
      }
      const data = await listingsRes.json() as { resources?: AvitoListItem[] };
      const batch = data.resources ?? [];
      for (const it of batch) statusCounts[it.status] = (statusCounts[it.status] ?? 0) + 1;
      allItems.push(...batch);
      if (batch.length < perPage) break;
      page++;
      if (page > 100) break;
    }

    let debugSample: unknown = null;
    let imagesFound = 0;

    async function fetchOgImageWithDebug(pageUrl: string): Promise<{ url: string | null; debug: Record<string, unknown> }> {
      try {
        const r = await fetch(pageUrl, {
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Accept-Language": "ru-RU,ru;q=0.9",
            Accept: "text/html,application/xhtml+xml,application/xml;q=0.9",
          },
          signal: AbortSignal.timeout(10000),
        });
        const html = await r.text();
        const isJunk = (u: string) => /icons?\/|touch-icon|favicon|logo|sprite/i.test(u);
        let url: string | null = null;

        const cdnMatches = html.matchAll(/https?:\/\/[^"'\s>]*avito\.st\/(?:image|stat|hi)[^"'\s>]*\.(?:jpg|jpeg|png|webp)/gi);
        for (const m of cdnMatches) {
          if (!isJunk(m[0])) {
            url = m[0];
            break;
          }
        }

        if (!url) {
          const ogTags = html.matchAll(/<meta\s[^>]*property=["']og:image(?::secure_url|:url)?["'][^>]*>/gi);
          for (const tag of ogTags) {
            const content = tag[0].match(/content=["']([^"']+)["']/i)?.[1];
            if (content && !isJunk(content)) {
              url = content;
              break;
            }
          }
        }

        if (!url) {
          const twTag = html.match(/<meta\s[^>]*(?:name|property)=["']twitter:image["'][^>]*>/i);
          const content = twTag?.[0].match(/content=["']([^"']+)["']/i)?.[1];
          if (content && !isJunk(content)) url = content;
        }
        const debug = {
          status: r.status,
          htmlLength: html.length,
          hasOgImage: html.includes("og:image"),
          hasTwitterImage: html.includes("twitter:image"),
          contentType: r.headers.get("content-type"),
          metaSnippet: html.match(/<meta[^>]*og[^>]*>/i)?.[0]?.slice(0, 300) ?? null,
          htmlStart: html.slice(0, 300),
        };
        return { url, debug };
      } catch (e) {
        return { url: null, debug: { error: String(e).slice(0, 200) } };
      }
    }

    const details = await processBatched(allItems, 2, 1200, async (item) => {
      const { url: imageUrl, debug } = await fetchOgImageWithDebug(item.url);
      if (debugSample === null) debugSample = { itemUrl: item.url, parsedImage: imageUrl, ...debug };
      if (imageUrl) imagesFound++;
      return { ...item, imageUrl };
    });

    let updated = 0;
    let created = 0;
    const now = new Date();

    for (const item of details) {
      const avitoItemId = String(item.id);
      const existing = await prisma.product.findUnique({ where: { avitoItemId } });
      const data = {
        name: item.title,
        salePrice: item.price,
        avitoListingUrl: item.url,
        avitoListingStatus: item.status,
        imageUrl: item.imageUrl,
        lastSyncedAt: now,
      };
      if (existing) {
        await prisma.product.update({ where: { avitoItemId }, data });
        updated++;
      } else {
        await prisma.product.create({ data: { ...data, avitoItemId } });
        created++;
      }
    }

    revalidatePath("/products");
    revalidatePath("/dashboard");
    return NextResponse.json({ updated, created, total: details.length, imagesFound, statusCounts, debugSample });
  } catch (e) {
    return NextResponse.json({ error: `Ошибка синхронизации: ${String(e).slice(0, 300)}` }, { status: 500 });
  }
}
