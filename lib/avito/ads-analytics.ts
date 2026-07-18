import { fetchWithRetry, fetchAllAvitoItems, type AvitoListItem } from "@/lib/avito/sync";
import { extractAvitoErrorText, getAvitoStockToken, type AvitoCredentials } from "@/lib/avito/stocks";
import { fetchAvitoAccountProfile } from "@/lib/avito/profile";

type FetchFn = typeof fetch;
type SleepFn = (ms: number) => Promise<void>;

type AvitoStatsCounters = {
  uniqViews?: number;
  uniqContacts?: number;
  uniqFavorites?: number;
  views?: number;
  contacts?: number;
  favorites?: number;
  [key: string]: unknown;
};

export type AvitoAdAnalyticsItem = {
  itemId: string;
  title: string;
  url: string | null;
  status: string | null;
  views: number;
  contacts: number;
  favorites: number;
};

export type AvitoAdsAnalyticsResult = {
  profileId: string;
  accountId: string;
  periodDays: number;
  dateFrom: string;
  dateTo: string;
  total: {
    ads: number;
    views: number;
    contacts: number;
    favorites: number;
  };
  items: AvitoAdAnalyticsItem[];
};

function dateOnly(value: Date): string {
  return value.toISOString().slice(0, 10);
}

export function buildRecentDateRange(periodDays: number, now = new Date()): { dateFrom: string; dateTo: string } {
  const days = Math.min(270, Math.max(1, Math.round(Number.isFinite(periodDays) ? periodDays : 3)));
  const to = new Date(now);
  const from = new Date(now);
  from.setUTCDate(from.getUTCDate() - days + 1);
  return { dateFrom: dateOnly(from), dateTo: dateOnly(to) };
}

function numberFrom(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function titleFrom(item: AvitoListItem): string {
  return item.title ?? item.name ?? `Avito ${String(item.id)}`;
}

function countersFrom(value: unknown): AvitoStatsCounters {
  if (!value || typeof value !== "object") return {};
  const record = value as Record<string, unknown>;
  const counters = record.stats ?? record.counters ?? record;
  return counters && typeof counters === "object" ? counters as AvitoStatsCounters : {};
}

function itemIdFromStats(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  for (const key of ["itemId", "item_id", "id"]) {
    const raw = record[key];
    if (typeof raw === "string" || typeof raw === "number") return String(raw);
  }
  return null;
}

export function parseAvitoStatsItems(data: unknown): Map<string, AvitoStatsCounters> {
  const root = data && typeof data === "object" ? data as Record<string, unknown> : {};
  const result = root.result && typeof root.result === "object" ? root.result as Record<string, unknown> : root;
  const items = result.items;
  const stats = new Map<string, AvitoStatsCounters>();

  if (Array.isArray(items)) {
    for (const item of items) {
      const itemId = itemIdFromStats(item);
      if (itemId) stats.set(itemId, countersFrom(item));
    }
    return stats;
  }

  if (items && typeof items === "object") {
    for (const [itemId, value] of Object.entries(items as Record<string, unknown>)) {
      const records = Array.isArray(value) ? value : [value];
      const sum: AvitoStatsCounters = {};
      for (const record of records) {
        const counters = countersFrom(record);
        sum.uniqViews = numberFrom(sum.uniqViews) + numberFrom(counters.uniqViews ?? counters.views);
        sum.uniqContacts = numberFrom(sum.uniqContacts) + numberFrom(counters.uniqContacts ?? counters.contacts);
        sum.uniqFavorites = numberFrom(sum.uniqFavorites) + numberFrom(counters.uniqFavorites ?? counters.favorites);
      }
      stats.set(String(itemId), sum);
    }
  }

  return stats;
}

async function fetchAvitoStats(
  token: string,
  accountId: string,
  itemIds: string[],
  range: { dateFrom: string; dateTo: string },
  options: { fetchFn?: FetchFn; sleepFn?: SleepFn } = {},
): Promise<Map<string, AvitoStatsCounters>> {
  const result = new Map<string, AvitoStatsCounters>();
  const chunkSize = 200;

  for (let i = 0; i < itemIds.length; i += chunkSize) {
    const chunk = itemIds.slice(i, i + chunkSize);
    const response = await fetchWithRetry(
      `https://api.avito.ru/stats/v1/accounts/${encodeURIComponent(accountId)}/items`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          dateFrom: range.dateFrom,
          dateTo: range.dateTo,
          fields: ["uniqViews", "uniqContacts", "uniqFavorites"],
          itemIds: chunk.map((id) => Number(id)),
          periodGrouping: "day",
        }),
        cache: "no-store",
        signal: AbortSignal.timeout(30_000),
      },
      options,
    );
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(`Получение статистики Avito не прошло: ${extractAvitoErrorText(data).slice(0, 300)}`);
    }

    for (const [itemId, counters] of parseAvitoStatsItems(data)) {
      result.set(itemId, counters);
    }

    if (i + chunkSize < itemIds.length) await (options.sleepFn ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms))))(150);
  }

  return result;
}

export async function fetchAvitoAdsAnalytics(
  input: { profileId: string; credentials: AvitoCredentials; periodDays: number },
  options: { fetchFn?: FetchFn; sleepFn?: SleepFn } = {},
): Promise<AvitoAdsAnalyticsResult> {
  const token = await getAvitoStockToken(input.credentials, options);
  const [accountProfile, listResult] = await Promise.all([
    fetchAvitoAccountProfile(input.credentials, options),
    fetchAllAvitoItems(token, options),
  ]);
  const range = buildRecentDateRange(input.periodDays);
  const ids = listResult.items.map((item) => String(item.id)).filter(Boolean);
  const stats = ids.length ? await fetchAvitoStats(token, accountProfile.id, ids, range, options) : new Map();

  const items = listResult.items.map((item) => {
    const itemId = String(item.id);
    const counters = stats.get(itemId) ?? {};
    return {
      itemId,
      title: titleFrom(item),
      url: item.url ?? null,
      status: item.status ?? null,
      views: numberFrom(counters.uniqViews ?? counters.views),
      contacts: numberFrom(counters.uniqContacts ?? counters.contacts),
      favorites: numberFrom(counters.uniqFavorites ?? counters.favorites),
    };
  }).sort((a, b) => (b.views - a.views) || (b.contacts - a.contacts) || (b.favorites - a.favorites));

  return {
    profileId: input.profileId,
    accountId: accountProfile.id,
    periodDays: input.periodDays,
    ...range,
    total: {
      ads: items.length,
      views: items.reduce((sum, item) => sum + item.views, 0),
      contacts: items.reduce((sum, item) => sum + item.contacts, 0),
      favorites: items.reduce((sum, item) => sum + item.favorites, 0),
    },
    items,
  };
}
