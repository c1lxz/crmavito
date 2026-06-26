import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db/prisma";

export const maxDuration = 300;

type AvitoListItem = {
  id: number | string;
  title?: string;
  name?: string;
  price?: number | string | { value?: number | string };
  url?: string;
  status?: string;
};

type SyncResult = {
  updated: number;
  created: number;
  total: number;
  imagesFound: number;
  statusCounts: Record<string, number>;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function errorResponse(message: string, status: number, details?: string) {
  const error = details ? `${message}: ${details.slice(0, 300)}` : message;
  console.error("[avito-sync]", error);
  return NextResponse.json({ error }, { status });
}

function getPrice(value: AvitoListItem["price"]): number {
  if (typeof value === "number") return value;
  if (typeof value === "string") return Number(value.replace(/[^\d.,]/g, "").replace(",", ".")) || 0;
  if (value && typeof value === "object") return getPrice(value.value);
  return 0;
}

async function fetchWithRetry(url: string, headers: Record<string, string>, retries = 3): Promise<Response> {
  for (let attempt = 0; attempt < retries; attempt++) {
    const response = await fetch(url, { headers, cache: "no-store", signal: AbortSignal.timeout(30000) });
    if (response.status !== 429) return response;
    await sleep(700 * (attempt + 1));
  }

  return fetch(url, { headers, cache: "no-store", signal: AbortSignal.timeout(30000) });
}

async function processBatched<T, R>(
  items: T[],
  batchSize: number,
  delayMs: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];

  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    const settled = await Promise.all(batch.map(fn));
    results.push(...settled);
    if (i + batchSize < items.length) await sleep(delayMs);
  }

  return results;
}

async function syncAvitoProducts(): Promise<SyncResult> {
  const clientId = process.env.AVITO_CLIENT_ID;
  const clientSecret = process.env.AVITO_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error("Avito API не настроен. Проверьте AVITO_CLIENT_ID и AVITO_CLIENT_SECRET в .env.");
  }

  const tokenRes = await fetch("https://api.avito.ru/token/", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret,
    }),
    cache: "no-store",
  });

  if (!tokenRes.ok) {
    throw new Error(`Авторизация Avito не прошла (${tokenRes.status}): ${(await tokenRes.text()).slice(0, 200)}`);
  }

  const tokenData = (await tokenRes.json()) as { access_token?: string };
  if (!tokenData.access_token) {
    throw new Error("Avito не вернул access_token.");
  }

  const authHeader = { Authorization: `Bearer ${tokenData.access_token}` };
  const allItems: AvitoListItem[] = [];
  const statusCounts: Record<string, number> = {};
  const perPage = 100;

  for (let page = 1; page <= 100; page++) {
    const listingsUrl = `https://api.avito.ru/core/v1/items?per_page=${perPage}&page=${page}`;
    const listingsRes = await fetchWithRetry(listingsUrl, authHeader);

    if (!listingsRes.ok) {
      throw new Error(`Получение списка объявлений, страница ${page} (${listingsRes.status}): ${(await listingsRes.text()).slice(0, 200)}`);
    }

    const data = (await listingsRes.json()) as { resources?: AvitoListItem[]; items?: AvitoListItem[] };
    const batch = data.resources ?? data.items ?? [];

    for (const item of batch) {
      const status = item.status ?? "unknown";
      statusCounts[status] = (statusCounts[status] ?? 0) + 1;
    }

    allItems.push(...batch);
    if (batch.length < perPage) break;
  }

  const details = allItems;
  const existingProducts = await prisma.product.findMany({
    where: { avitoItemId: { in: details.map((item) => String(item.id)) } },
    select: { avitoItemId: true },
  });
  const existingIds = new Set(existingProducts.map((product) => product.avitoItemId).filter(Boolean));

  let updated = 0;
  let created = 0;
  let imagesFound = 0;
  const now = new Date();

  await processBatched(details, 20, 100, async (item) => {
    const avitoItemId = String(item.id);
    const data = {
      name: item.title ?? item.name ?? `Avito ${avitoItemId}`,
      salePrice: getPrice(item.price),
      avitoListingUrl: item.url ?? null,
      avitoListingStatus: item.status ?? null,
      lastSyncedAt: now,
    };

    if (existingIds.has(avitoItemId)) updated++;
    else created++;

    await prisma.product.upsert({
      where: { avitoItemId },
      update: data,
      create: { ...data, avitoItemId, imageUrl: null },
    });
  });

  revalidatePath("/products");
  revalidatePath("/dashboard");

  return { updated, created, total: details.length, imagesFound, statusCounts };
}

export async function POST(req: Request) {
  const cronSecret = process.env.CRON_SECRET;
  const headerSecret = req.headers.get("x-cron-secret");
  const isCron = Boolean(cronSecret && headerSecret === cronSecret);

  if (!isCron) {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Не авторизован." }, { status: 401 });
  }

  try {
    const result = await syncAvitoProducts();
    console.log("[avito-sync] completed", result);
    return NextResponse.json(result);
  } catch (error) {
    return errorResponse("Ошибка синхронизации Avito", 500, error instanceof Error ? error.message : String(error));
  }
}
