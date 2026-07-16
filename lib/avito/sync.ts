import type { PrismaClient } from "@prisma/client";
import { fetchAvitoItemImageWithToken, findFirstImageUrl } from "./api";
import { fetchAvitoListingImage } from "./fetch-image";
import { findBotvImageByTitle } from "@/lib/botv/avito-image-cache";

export type AvitoListItem = {
  id: number | string;
  title?: string;
  name?: string;
  price?: number | string | { value?: number | string };
  url?: string;
  status?: string;
  [key: string]: unknown;
};

export type SyncResult = {
  updated: number;
  created: number;
  archived: number;
  total: number;
  imagesFound: number;
  statusCounts: Record<string, number>;
};

type SyncPrisma = Pick<PrismaClient, "product">;
type FetchFn = typeof fetch;
type SleepFn = (ms: number) => Promise<void>;

const RETRYABLE_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);
const defaultSleep: SleepFn = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const DEFAULT_PAGE_DELAY_MS = 900;
const DEFAULT_HTML_IMAGE_LIMIT = 120;
const DEFAULT_IMAGE_DETAIL_LIMIT = 0;

function getEnvNumber(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

function retryDelay(response: Response | null, attempt: number): number {
  const retryAfter = response?.headers.get("retry-after");
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds)) return Math.min(seconds * 1000, 60_000);
    const retryAt = Date.parse(retryAfter);
    if (Number.isFinite(retryAt)) return Math.min(Math.max(retryAt - Date.now(), 0), 60_000);
  }
  if (response?.status === 429) return Math.min(5_000 * 2 ** attempt, 60_000);
  return Math.min(750 * 2 ** attempt, 10_000);
}

export async function fetchWithRetry(
  url: string,
  init: RequestInit,
  options: {
    attempts?: number;
    fetchFn?: FetchFn;
    sleepFn?: SleepFn;
  } = {},
): Promise<Response> {
  const attempts = options.attempts ?? 5;
  const fetchFn = options.fetchFn ?? fetch;
  const sleepFn = options.sleepFn ?? defaultSleep;
  let lastError: unknown;

  for (let attempt = 0; attempt < attempts; attempt++) {
    let response: Response | null = null;
    try {
      response = await fetchFn(url, init);
      if (!RETRYABLE_STATUSES.has(response.status) || attempt === attempts - 1) {
        return response;
      }
    } catch (error) {
      lastError = error;
      if (attempt === attempts - 1) throw error;
    }
    await sleepFn(retryDelay(response, attempt));
  }

  throw lastError instanceof Error ? lastError : new Error("Avito request failed");
}

export async function fetchAllAvitoItems(
  token: string,
  options: {
    fetchFn?: FetchFn;
    sleepFn?: SleepFn;
    perPage?: number;
    maxPages?: number;
    pageDelayMs?: number;
  } = {},
): Promise<{ items: AvitoListItem[]; statusCounts: Record<string, number> }> {
  const fetchFn = options.fetchFn ?? fetch;
  const sleepFn = options.sleepFn ?? defaultSleep;
  const perPage = options.perPage ?? 100;
  const maxPages = options.maxPages ?? 100;
  const pageDelayMs = options.pageDelayMs ?? getEnvNumber("AVITO_SYNC_PAGE_DELAY_MS", DEFAULT_PAGE_DELAY_MS);
  const itemsById = new Map<string, AvitoListItem>();
  const statusCounts: Record<string, number> = {};
  let reachedEnd = false;

  for (let page = 1; page <= maxPages; page++) {
    const url = `https://api.avito.ru/core/v1/items?per_page=${perPage}&page=${page}`;
    const response = await fetchWithRetry(
      url,
      {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
        signal: AbortSignal.timeout(30_000),
      },
      { fetchFn, sleepFn },
    );

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      if (response.status === 429) {
        throw new Error(
          `Avito limited request rate on page ${page}. Wait a few minutes and start sync again. ${body.slice(0, 200)}`,
        );
      }
      throw new Error(
        `Получение объявлений Avito, страница ${page} (${response.status}): ${body.slice(0, 200)}`,
      );
    }

    let data: { resources?: AvitoListItem[]; items?: AvitoListItem[] };
    try {
      data = (await response.json()) as typeof data;
    } catch {
      throw new Error(`Avito вернул некорректный JSON на странице ${page}`);
    }

    const batch = data.resources ?? data.items ?? [];
    if (batch.length === 0) {
      reachedEnd = true;
      break;
    }

    for (const item of batch) {
      if (item.id == null) continue;
      itemsById.set(String(item.id), item);
    }

    // A short page is not necessarily the end: Avito can return a partial page
    // during transient load. The following empty page is the reliable boundary.
    if (page < maxPages && pageDelayMs > 0) await sleepFn(pageDelayMs);
  }

  if (!reachedEnd) {
    throw new Error(`Avito pagination exceeded the safety limit of ${maxPages} pages`);
  }

  for (const item of itemsById.values()) {
    const status = item.status ?? "unknown";
    statusCounts[status] = (statusCounts[status] ?? 0) + 1;
  }

  return { items: [...itemsById.values()], statusCounts };
}

function getPrice(value: AvitoListItem["price"]): number {
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    return Number(value.replace(/[^\d.,]/g, "").replace(",", ".")) || 0;
  }
  if (value && typeof value === "object") return getPrice(value.value);
  return 0;
}

async function retryUpsert(operation: () => Promise<unknown>, sleepFn: SleepFn): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await operation();
      return;
    } catch (error) {
      lastError = error;
      if (attempt < 2) await sleepFn(150 * 2 ** attempt);
    }
  }
  throw lastError;
}

export async function syncAvitoProducts(
  prisma: SyncPrisma,
  credentials: { clientId: string; clientSecret: string },
  options: { fetchFn?: FetchFn; sleepFn?: SleepFn } = {},
): Promise<SyncResult> {
  const fetchFn = options.fetchFn ?? fetch;
  const sleepFn = options.sleepFn ?? defaultSleep;
  const tokenResponse = await fetchWithRetry(
    "https://api.avito.ru/token/",
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: credentials.clientId,
        client_secret: credentials.clientSecret,
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    },
    { fetchFn, sleepFn },
  );

  if (!tokenResponse.ok) {
    throw new Error(
      `Авторизация Avito не прошла (${tokenResponse.status}): ${(await tokenResponse.text()).slice(0, 200)}`,
    );
  }

  const tokenData = (await tokenResponse.json()) as { access_token?: string };
  if (!tokenData.access_token) throw new Error("Avito не вернул access_token");

  const { items, statusCounts } = await fetchAllAvitoItems(tokenData.access_token, {
    fetchFn,
    sleepFn,
  });
  const ids = items.map((item) => String(item.id));
  const existingProducts = ids.length
    ? await prisma.product.findMany({
        where: { avitoItemId: { in: ids } },
        select: { avitoItemId: true, imageUrl: true },
      })
    : [];
  const existingIds = new Set(
    existingProducts.map((product) => product.avitoItemId).filter(Boolean),
  );
  const existingImagesById = new Map(
    existingProducts
      .filter((product) => product.avitoItemId && product.imageUrl)
      .map((product) => [product.avitoItemId as string, product.imageUrl as string]),
  );
  const imageUrlsById = new Map<string, string>();
  const htmlImageLimit = getEnvNumber("AVITO_SYNC_HTML_IMAGE_LIMIT", DEFAULT_HTML_IMAGE_LIMIT);
  const imageDetailLimit = getEnvNumber("AVITO_SYNC_IMAGE_DETAIL_LIMIT", DEFAULT_IMAGE_DETAIL_LIMIT);
  let htmlImageAttempts = 0;
  let htmlBlocked = false;
  let imageDetailAttempts = 0;

  for (const item of items) {
    const avitoItemId = String(item.id);
    const listImageUrl = findFirstImageUrl(item);
    if (listImageUrl) {
      imageUrlsById.set(avitoItemId, listImageUrl);
      continue;
    }

    const existingImageUrl = existingImagesById.get(avitoItemId);
    if (existingImageUrl) {
      imageUrlsById.set(avitoItemId, existingImageUrl);
      continue;
    }

    if (!htmlBlocked && item.url && htmlImageAttempts < htmlImageLimit) {
      htmlImageAttempts++;
      const htmlImage = await fetchAvitoListingImage(item.url);
      if (htmlImage.ok) {
        imageUrlsById.set(avitoItemId, htmlImage.value);
        if (htmlImageAttempts < htmlImageLimit) await sleepFn(800);
        continue;
      }
      if (/HTTP 429|HTTP 439|blocked by Avito/i.test(htmlImage.reason)) htmlBlocked = true;
      if (htmlImageAttempts < htmlImageLimit && !htmlBlocked) await sleepFn(800);
    }

    const botvImageUrl = await findBotvImageByTitle(item.title ?? item.name);
    if (botvImageUrl) {
      imageUrlsById.set(avitoItemId, botvImageUrl);
      continue;
    }

    if (imageDetailAttempts >= imageDetailLimit) continue;
    imageDetailAttempts++;
    const detailImage = await fetchAvitoItemImageWithToken(avitoItemId, tokenData.access_token, { fetchFn });
    if (detailImage.ok) imageUrlsById.set(avitoItemId, detailImage.value);
    if (imageDetailAttempts < imageDetailLimit) await sleepFn(500);
  }

  let updated = 0;
  let created = 0;
  let imagesFound = 0;
  const now = new Date();
  const batchSize = 20;

  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    await Promise.all(
      batch.map(async (item) => {
        const avitoItemId = String(item.id);
        const imageUrl = imageUrlsById.get(avitoItemId) ?? null;
        const data = {
          name: item.title ?? item.name ?? `Avito ${avitoItemId}`,
          salePrice: getPrice(item.price),
          avitoListingUrl: item.url ?? null,
          avitoListingStatus: item.status ?? null,
          ...(imageUrl ? { imageUrl } : {}),
          lastSyncedAt: now,
        };

        await retryUpsert(
          () =>
            prisma.product.upsert({
              where: { avitoItemId },
              update: data,
              create: { ...data, avitoItemId, imageUrl: imageUrl ?? null },
            }),
          sleepFn,
        );

        if (imageUrl) imagesFound++;
        if (existingIds.has(avitoItemId)) updated++;
        else created++;
      }),
    );
    if (i + batchSize < items.length) await sleepFn(100);
  }

  const archived =
    ids.length > 0
      ? await prisma.product.updateMany({
          where: {
            avitoItemId: { not: null, notIn: ids },
            avitoListingStatus: { not: "inactive" },
          },
          data: { avitoListingStatus: "inactive" },
        })
      : { count: 0 };

  return {
    updated,
    created,
    archived: archived.count,
    total: items.length,
    imagesFound,
    statusCounts,
  };
}
