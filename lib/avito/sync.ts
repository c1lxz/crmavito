import type { PrismaClient } from "@prisma/client";
import { findFirstImageUrl } from "./api";

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

function retryDelay(response: Response | null, attempt: number): number {
  const retryAfter = response?.headers.get("retry-after");
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds)) return Math.min(seconds * 1000, 10_000);
  }
  return Math.min(500 * 2 ** attempt, 5_000);
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
  const attempts = options.attempts ?? 4;
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
  } = {},
): Promise<{ items: AvitoListItem[]; statusCounts: Record<string, number> }> {
  const fetchFn = options.fetchFn ?? fetch;
  const sleepFn = options.sleepFn ?? defaultSleep;
  const perPage = options.perPage ?? 100;
  const maxPages = options.maxPages ?? 100;
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
        select: { avitoItemId: true },
      })
    : [];
  const existingIds = new Set(
    existingProducts.map((product) => product.avitoItemId).filter(Boolean),
  );

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
        const imageUrl = findFirstImageUrl(item);
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
