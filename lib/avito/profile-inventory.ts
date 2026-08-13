import { fetchAvitoAutoloadStatus } from "@/lib/avito/publish";
import { fetchAllAvitoItems, fetchWithRetry, type AvitoListItem } from "@/lib/avito/sync";
import { getAvitoStockToken, type AvitoCredentials } from "@/lib/avito/stocks";

type FetchFn = typeof fetch;
type SleepFn = (ms: number) => Promise<void>;

export type AvitoProfileListing = {
  avitoId: string;
  title: string;
  address: string;
  externalId: string | null;
};

export type AvitoProfileInventory = {
  activeListings: AvitoProfileListing[];
  retiredExternalIds: string[];
  activeAds: number;
  autoloadAds: number;
  manualAds: number;
};

type ReportItem = {
  ad_id?: string | number;
  avito_id?: string | number;
  avito_status?: string;
  section?: { slug?: string };
};

function stringValue(value: unknown): string {
  return typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
}

function uploadIds(status: Awaited<ReturnType<typeof fetchAvitoAutoloadStatus>>): string[] {
  const ids = new Set<string>();
  for (const value of [status.current, status.lastSuccessful, ...status.uploads]) {
    if (!value || typeof value !== "object") continue;
    const id = stringValue((value as { upload_id?: unknown }).upload_id);
    if (id) ids.add(id);
  }
  return [...ids];
}

async function reportItems(
  token: string,
  uploadId: string,
  options: { fetchFn?: FetchFn; sleepFn?: SleepFn },
): Promise<ReportItem[]> {
  const items: ReportItem[] = [];
  for (let page = 0; page < 30; page += 1) {
    const response = await fetchWithRetry(
      `https://api.avito.ru/autoload/v2/reports/${encodeURIComponent(uploadId)}/items?page=${page}&per_page=100`,
      () => ({
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
        signal: AbortSignal.timeout(30_000),
      }),
      options,
    );
    if (response.status === 404) break;
    if (!response.ok) {
      throw new Error(`Не удалось прочитать отчёт автозагрузки Avito ${uploadId}: HTTP ${response.status}.`);
    }
    const data = (await response.json()) as { items?: ReportItem[] };
    const pageItems = Array.isArray(data.items) ? data.items : [];
    items.push(...pageItems);
    if (pageItems.length < 100) break;
  }
  return items;
}

async function accountId(token: string, options: { fetchFn?: FetchFn; sleepFn?: SleepFn }): Promise<string> {
  const response = await fetchWithRetry(
    "https://api.avito.ru/core/v1/accounts/self",
    () => ({
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
      signal: AbortSignal.timeout(30_000),
    }),
    options,
  );
  const data = (await response.json().catch(() => ({}))) as { id?: string | number };
  const id = stringValue(data.id);
  if (!response.ok || !id) throw new Error("Не удалось определить аккаунт Avito для первичной синхронизации XML.");
  return id;
}

async function externalIdFromDetail(
  token: string,
  ownerId: string,
  avitoId: string,
  options: { fetchFn?: FetchFn; sleepFn?: SleepFn },
): Promise<string | null> {
  const response = await fetchWithRetry(
    `https://api.avito.ru/core/v1/accounts/${encodeURIComponent(ownerId)}/items/${encodeURIComponent(avitoId)}`,
    () => ({
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
      signal: AbortSignal.timeout(30_000),
    }),
    options,
  );
  if (!response.ok) {
    throw new Error(`Не удалось сопоставить активное объявление Avito ${avitoId} с XML-ID: HTTP ${response.status}. Публикация остановлена.`);
  }
  const data = (await response.json()) as { autoload_item_id?: unknown };
  return stringValue(data.autoload_item_id) || null;
}

export async function fetchAvitoProfileInventory(
  credentials: AvitoCredentials,
  options: { fetchFn?: FetchFn; sleepFn?: SleepFn } = {},
): Promise<AvitoProfileInventory> {
  const token = await getAvitoStockToken(credentials, options);
  const [active, status] = await Promise.all([
    fetchAllAvitoItems(token, {
      fetchFn: options.fetchFn,
      sleepFn: options.sleepFn,
      status: "active",
      perPage: 99,
      maxPages: 100,
      pageDelayMs: 0,
      requestTimeoutMs: 30_000,
    }),
    fetchAvitoAutoloadStatus(credentials, options),
  ]);
  if (active.warning) throw new Error(`${active.warning} Публикация XML остановлена: профиль прочитан не полностью.`);

  const externalByAvitoId = new Map<string, string>();
  const retiredExternalIds = new Set<string>();
  for (const id of uploadIds(status)) {
    for (const item of await reportItems(token, id, options)) {
      const externalId = stringValue(item.ad_id);
      const avitoId = stringValue(item.avito_id);
      if (!externalId) continue;
      const itemStatus = stringValue(item.avito_status).toLowerCase();
      const section = stringValue(item.section?.slug).toLowerCase();
      if (avitoId && itemStatus === "active") externalByAvitoId.set(avitoId, externalId);
      if (["removed", "blocked", "rejected"].includes(itemStatus) || section === "error_deleted") {
        retiredExternalIds.add(externalId);
      }
    }
  }

  const unresolved = active.items.filter((item) => !externalByAvitoId.has(String(item.id)));
  if (unresolved.length) {
    const ownerId = await accountId(token, options);
    for (const item of unresolved) {
      const avitoId = String(item.id);
      const externalId = await externalIdFromDetail(token, ownerId, avitoId, options);
      if (externalId) externalByAvitoId.set(avitoId, externalId);
    }
  }

  const activeListings = active.items.map((item: AvitoListItem) => ({
    avitoId: String(item.id),
    title: stringValue(item.title ?? item.name),
    address: stringValue(item.address),
    externalId: externalByAvitoId.get(String(item.id)) ?? null,
  }));
  const autoloadAds = activeListings.filter((item) => item.externalId).length;
  return {
    activeListings,
    retiredExternalIds: [...retiredExternalIds],
    activeAds: activeListings.length,
    autoloadAds,
    manualAds: activeListings.length - autoloadAds,
  };
}
