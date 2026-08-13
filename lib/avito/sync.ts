import type { PrismaClient } from "@prisma/client";
import { fetchAvitoItemDetailWithToken, findFirstImageUrl } from "./api";
import { fetchAvitoListingImage } from "./fetch-image";
import { findBotvImageByExternalId, findBotvImageByTitle } from "@/lib/botv/avito-image-cache";

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
  profileId?: string;
};

type SyncPrisma = Pick<PrismaClient, "product" | "productAvitoListing">;
type FetchFn = typeof fetch;
type SleepFn = (ms: number) => Promise<void>;

const RETRYABLE_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);
const defaultSleep: SleepFn = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const DEFAULT_PAGE_DELAY_MS = 900;
const DEFAULT_HTML_IMAGE_LIMIT = 120;
const DEFAULT_IMAGE_DETAIL_LIMIT = 120;

function getEnvNumber(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

function findAutoloadItemId(value: unknown, depth = 0): string | null {
  if (depth > 6 || value == null) return null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findAutoloadItemId(item, depth + 1);
      if (found) return found;
    }
    return null;
  }
  if (typeof value !== "object") return null;

  const record = value as Record<string, unknown>;
  for (const key of ["autoload_item_id", "autoloadItemId", "external_id", "externalId", "xml_id"]) {
    const raw = record[key];
    if (typeof raw === "string" || typeof raw === "number") {
      const id = String(raw).trim();
      if (id) return id;
    }
  }

  for (const key of Object.keys(record)) {
    const found = findAutoloadItemId(record[key], depth + 1);
    if (found) return found;
  }
  return null;
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
  init: RequestInit | (() => RequestInit),
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
      response = await fetchFn(url, typeof init === "function" ? init() : init);
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

export async function fetchAvitoItemsPage(
  token: string,
  options: {
    fetchFn?: FetchFn;
    sleepFn?: SleepFn;
    page: number;
    perPage?: number;
    status?: string;
    requestAttempts?: number;
    requestTimeoutMs?: number;
  },
): Promise<{ items: AvitoListItem[]; page: number; perPage: number }> {
  const fetchFn = options.fetchFn ?? fetch;
  const sleepFn = options.sleepFn ?? defaultSleep;
  const page = Math.max(1, Math.floor(options.page));
  const perPage = Math.max(1, Math.floor(options.perPage ?? 25));
  const requestAttempts = options.requestAttempts ?? 5;
  const requestTimeoutMs = options.requestTimeoutMs ?? 45_000;
  const url = new URL("https://api.avito.ru/core/v1/items");
  url.searchParams.set("per_page", String(perPage));
  url.searchParams.set("page", String(page));
  if (options.status?.trim()) url.searchParams.set("status", options.status.trim());

  const response = await fetchWithRetry(
    url.toString(),
    () => ({
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
      signal: AbortSignal.timeout(requestTimeoutMs),
    }),
    { attempts: requestAttempts, fetchFn, sleepFn },
  );

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    if (response.status === 429) {
      throw new Error(
        `Avito limited request rate on page ${page}. Wait a few minutes and start sync again. ${body.slice(0, 200)}`,
      );
    }
    throw new Error(
      `Avito items page ${page} failed (${response.status}): ${body.slice(0, 200)}`,
    );
  }

  let data: { resources?: AvitoListItem[]; items?: AvitoListItem[] };
  try {
    data = (await response.json()) as typeof data;
  } catch {
    throw new Error(`Avito returned invalid JSON on page ${page}`);
  }

  return { items: data.resources ?? data.items ?? [], page, perPage };
}

function extractAvitoErrorText(value: unknown): string {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(extractAvitoErrorText).filter(Boolean).join("; ");
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    return (
      extractAvitoErrorText(record.message) ||
      extractAvitoErrorText(record.error) ||
      extractAvitoErrorText(record.errors) ||
      JSON.stringify(value)
    );
  }
  return String(value);
}

function formatAvitoAuthError(value: unknown): string {
  const text = extractAvitoErrorText(value).slice(0, 300);
  if (text.includes("unauthorized_client")) {
    return [
      "unauthorized_client.",
      "Avito не разрешил этим client_id/client_secret получать API-токен.",
      "Проверьте, что ключи взяты именно из нужного профиля Avito, на аккаунте подключен доступ к API/интеграциям и приложение допущено к client_credentials.",
    ].join(" ");
  }
  return text || "Avito не вернул access_token";
}

async function readJsonResponse(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { message: text };
  }
}

export async function fetchAllAvitoItems(
  token: string,
  options: {
    fetchFn?: FetchFn;
    sleepFn?: SleepFn;
    perPage?: number;
    maxPages?: number;
    pageDelayMs?: number;
    emptyPagesToStop?: number;
    status?: string;
    allowPartialOnPageError?: boolean;
    requestTimeoutMs?: number;
    warningPrefix?: string;
  } = {},
): Promise<{ items: AvitoListItem[]; statusCounts: Record<string, number>; warning?: string }> {
  const fetchFn = options.fetchFn ?? fetch;
  const sleepFn = options.sleepFn ?? defaultSleep;
  const perPage = options.perPage ?? 99;
  const maxPages = options.maxPages ?? 100;
  const pageDelayMs = options.pageDelayMs ?? getEnvNumber("AVITO_SYNC_PAGE_DELAY_MS", DEFAULT_PAGE_DELAY_MS);
  const emptyPagesToStop = Math.max(1, options.emptyPagesToStop ?? 1);
  const requestTimeoutMs = options.requestTimeoutMs ?? 30_000;
  const itemsById = new Map<string, AvitoListItem>();
  const statusCounts: Record<string, number> = {};
  let emptyPages = 0;
  let reachedEnd = false;

  for (let page = 1; page <= maxPages; page++) {
    const url = new URL("https://api.avito.ru/core/v1/items");
    url.searchParams.set("per_page", String(perPage));
    url.searchParams.set("page", String(page));
    if (options.status?.trim()) url.searchParams.set("status", options.status.trim());
    let response: Response;
    try {
      response = await fetchWithRetry(
        url.toString(),
        {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
          signal: AbortSignal.timeout(requestTimeoutMs),
        },
        { fetchFn, sleepFn },
      );
    } catch (error) {
      if (options.allowPartialOnPageError && itemsById.size > 0) {
        return finalizeAvitoItems(itemsById, statusCounts, `${options.warningPrefix ?? "Avito временно прервал загрузку объявлений"} на странице ${page}. Загружено: ${itemsById.size}. ${error instanceof Error ? error.message : String(error)}`);
      }
      throw error;
    }

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      if (options.allowPartialOnPageError && itemsById.size > 0 && (response.status === 429 || response.status >= 500)) {
        return finalizeAvitoItems(
          itemsById,
          statusCounts,
          `${options.warningPrefix ?? "Avito временно прервал загрузку объявлений"} на странице ${page} (${response.status}). Загружено: ${itemsById.size}. ${body.slice(0, 200)}`,
        );
      }
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
      emptyPages += 1;
      if (emptyPages >= emptyPagesToStop) {
        reachedEnd = true;
        break;
      }
      if (page < maxPages && pageDelayMs > 0) await sleepFn(pageDelayMs);
      continue;
    }
    emptyPages = 0;

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

  return finalizeAvitoItems(itemsById, statusCounts);
}

function finalizeAvitoItems(
  itemsById: Map<string, AvitoListItem>,
  statusCounts: Record<string, number>,
  warning?: string,
): { items: AvitoListItem[]; statusCounts: Record<string, number>; warning?: string } {
  for (const item of itemsById.values()) {
    const status = item.status ?? "unknown";
    statusCounts[status] = (statusCounts[status] ?? 0) + 1;
  }

  return { items: [...itemsById.values()], statusCounts, warning };
}

function getPrice(value: AvitoListItem["price"]): number {
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    return Number(value.replace(/[^\d.,]/g, "").replace(",", ".")) || 0;
  }
  if (value && typeof value === "object") return getPrice(value.value);
  return 0;
}

export function normalizeProductName(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("ru-RU")
    .replace(/ё/g, "е")
    .replace(/[\u00a0\s]+/g, " ")
    .replace(/[‐‑‒–—―]/g, "-")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
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
  options: { fetchFn?: FetchFn; sleepFn?: SleepFn; profileId?: string; enrichMissingImages?: boolean } = {},
): Promise<SyncResult> {
  const fetchFn = options.fetchFn ?? fetch;
  const sleepFn = options.sleepFn ?? defaultSleep;
  const enrichMissingImages = options.enrichMissingImages ?? true;
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

  const tokenData = (await readJsonResponse(tokenResponse)) as { access_token?: string };
  if (!tokenResponse.ok || !tokenData.access_token) {
    throw new Error(`Авторизация Avito не прошла: ${formatAvitoAuthError(tokenData)}`);
  }

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
  let htmlNetworkFailures = 0;
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

    const botvImageUrl = await findBotvImageByTitle(item.title ?? item.name);
    if (botvImageUrl) {
      imageUrlsById.set(avitoItemId, botvImageUrl);
      continue;
    }

    // Page HTML and detail endpoints are heavily rate-limited by Avito. The multi-profile
    // catalog uses list images and local BotV images so one sync cannot take many minutes.
    if (!enrichMissingImages) continue;

    if (!htmlBlocked && item.url && htmlImageAttempts < htmlImageLimit) {
      htmlImageAttempts++;
      const htmlImage = await fetchAvitoListingImage(item.url);
      if (htmlImage.ok) {
        htmlNetworkFailures = 0;
        imageUrlsById.set(avitoItemId, htmlImage.value);
        if (htmlImageAttempts < htmlImageLimit) await sleepFn(800);
        continue;
      }
      if (/HTTP 429|HTTP 439|blocked by Avito/i.test(htmlImage.reason)) htmlBlocked = true;
      if (/HTML scrape error/i.test(htmlImage.reason)) {
        htmlNetworkFailures++;
        if (htmlNetworkFailures >= 5) htmlBlocked = true;
      }
      if (htmlImageAttempts < htmlImageLimit && !htmlBlocked) await sleepFn(800);
    }

    if (imageDetailAttempts >= imageDetailLimit) continue;
    imageDetailAttempts++;
    const detail = await fetchAvitoItemDetailWithToken(avitoItemId, tokenData.access_token, { fetchFn });
    if (detail.ok) {
      const detailImage = findFirstImageUrl(detail.value);
      if (detailImage) {
        imageUrlsById.set(avitoItemId, detailImage);
      } else {
        const botvImageByExternalId = await findBotvImageByExternalId(findAutoloadItemId(detail.value));
        if (botvImageByExternalId) imageUrlsById.set(avitoItemId, botvImageByExternalId);
      }
    }
    if (imageDetailAttempts < imageDetailLimit) await sleepFn(500);
  }

  let updated = 0;
  let created = 0;
  let imagesFound = 0;
  const now = new Date();
  const batchSize = 20;

  if (options.profileId) {
    const profileId = options.profileId;
    const existingListings = ids.length
      ? await prisma.productAvitoListing.findMany({
          where: { avitoProfileId: profileId, avitoItemId: { in: ids } },
          select: { avitoItemId: true, productId: true },
        })
      : [];
    const productIdsByItemId = new Map(
      existingListings.map((listing) => [listing.avitoItemId, listing.productId]),
    );
    const names = [...new Set(items.map((item) => normalizeProductName(item.title ?? item.name ?? "")).filter(Boolean))];
    const productsByName = names.length
      ? await prisma.product.findMany({
          where: { normalizedName: { in: names } },
          select: { id: true, normalizedName: true },
          orderBy: { createdAt: "asc" },
        })
      : [];
    const productIdsByName = new Map<string, string>();
    for (const product of productsByName) {
      if (product.normalizedName && !productIdsByName.has(product.normalizedName)) {
        productIdsByName.set(product.normalizedName, product.id);
      }
    }

    for (const item of items) {
      const avitoItemId = String(item.id);
      const name = item.title ?? item.name ?? `Avito ${avitoItemId}`;
      const normalizedName = normalizeProductName(name) || `avito ${avitoItemId}`;
      const price = getPrice(item.price);
      const imageUrl = imageUrlsById.get(avitoItemId) ?? null;
      let productId = productIdsByItemId.get(avitoItemId) ?? productIdsByName.get(normalizedName);

      if (!productId) {
        const legacyProduct = await prisma.product.findUnique({
          where: { avitoItemId },
          select: { id: true },
        });
        productId = legacyProduct?.id;
      }

      if (!productId) {
        const product = await prisma.product.create({
          data: {
            name,
            normalizedName,
            salePrice: price,
            avitoItemId,
            avitoListingUrl: item.url ?? null,
            avitoListingStatus: item.status ?? null,
            imageUrl,
            lastSyncedAt: now,
          },
          select: { id: true },
        });
        productId = product.id;
        productIdsByName.set(normalizedName, product.id);
        created++;
      } else {
        await prisma.product.update({
          where: { id: productId },
          data: {
            normalizedName,
            salePrice: price,
            lastSyncedAt: now,
            ...(!existingIds.has(avitoItemId) ? {} : {
              name,
              avitoListingUrl: item.url ?? null,
              avitoListingStatus: item.status ?? null,
            }),
            ...(imageUrl ? { imageUrl } : {}),
          },
        });
        updated++;
      }

      await prisma.productAvitoListing.upsert({
        where: { avitoProfileId_avitoItemId: { avitoProfileId: profileId, avitoItemId } },
        update: {
          productId,
          listingUrl: item.url ?? null,
          listingStatus: item.status ?? null,
          price,
          ...(imageUrl ? { imageUrl } : {}),
          lastSyncedAt: now,
        },
        create: {
          productId,
          avitoProfileId: profileId,
          avitoItemId,
          listingUrl: item.url ?? null,
          listingStatus: item.status ?? null,
          price,
          imageUrl,
          lastSyncedAt: now,
        },
      });
      if (imageUrl) imagesFound++;
    }

    const archived = ids.length
      ? await prisma.productAvitoListing.updateMany({
          where: {
            avitoProfileId: profileId,
            avitoItemId: { notIn: ids },
            listingStatus: { not: "inactive" },
          },
          data: { listingStatus: "inactive" },
        })
      : { count: 0 };

    return {
      profileId,
      updated,
      created,
      archived: archived.count,
      total: items.length,
      imagesFound,
      statusCounts,
    };
  }

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
