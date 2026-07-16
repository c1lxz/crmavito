import { findFirstImageUrl } from "@/lib/avito/api";
import { fetchAllAvitoItems, fetchWithRetry, type AvitoListItem } from "@/lib/avito/sync";

export type AvitoCredentials = {
  clientId: string;
  clientSecret: string;
};

export type AvitoStockItem = {
  itemId: string;
  title: string;
  price: number;
  url: string | null;
  status: string | null;
  imageUrl: string | null;
  quantity: number | null;
  isUnlimited: boolean;
  isOutOfStock: boolean;
  isMultiple: boolean;
};

export type AvitoStockUpdate = {
  itemId: string;
  quantity: number;
};

type FetchFn = typeof fetch;
type SleepFn = (ms: number) => Promise<void>;

type StockInfo = {
  item_id: number | string;
  quantity?: number | null;
  is_unlimited?: boolean;
  is_out_of_stock?: boolean;
  is_multiple?: boolean;
};

type StockUpdateResult = {
  item_id: number | string;
  success?: boolean;
  error?: string;
  message?: string;
};

function getPrice(value: AvitoListItem["price"]): number {
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    return Number(value.replace(/[^\d.,]/g, "").replace(",", ".")) || 0;
  }
  if (value && typeof value === "object") return getPrice(value.value);
  return 0;
}

export function extractAvitoErrorText(value: unknown): string {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(extractAvitoErrorText).filter(Boolean).join("; ");
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    return (
      extractAvitoErrorText(record.message) ||
      extractAvitoErrorText(record.error) ||
      extractAvitoErrorText(record.errors) ||
      extractAvitoErrorText(record.result) ||
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

export async function getAvitoStockToken(
  credentials: AvitoCredentials,
  options: { fetchFn?: FetchFn; sleepFn?: SleepFn } = {},
): Promise<string> {
  const response = await fetchWithRetry(
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
    options,
  );

  const data = (await readJsonResponse(response)) as { access_token?: string };
  if (!response.ok || !data.access_token) {
    throw new Error(`Авторизация Avito не прошла: ${formatAvitoAuthError(data)}`);
  }

  return data.access_token;
}

export async function fetchAvitoStocksInfo(
  token: string,
  itemIds: string[],
  options: { fetchFn?: FetchFn; sleepFn?: SleepFn } = {},
): Promise<Map<string, StockInfo>> {
  const result = new Map<string, StockInfo>();
  const chunkSize = 10;

  for (let i = 0; i < itemIds.length; i += chunkSize) {
    const chunk = itemIds.slice(i, i + chunkSize);
    const response = await fetchWithRetry(
      "https://api.avito.ru/stock-management/1/info",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ item_ids: chunk.map((id) => Number(id)) }),
        cache: "no-store",
        signal: AbortSignal.timeout(30_000),
      },
      options,
    );

    const data = (await readJsonResponse(response)) as { stocks?: StockInfo[] };
    if (!response.ok) {
      throw new Error(`Получение остатков Avito не прошло: ${extractAvitoErrorText(data).slice(0, 300)}`);
    }

    for (const stock of data.stocks ?? []) {
      result.set(String(stock.item_id), stock);
    }
  }

  return result;
}

export async function fetchAvitoStockItems(
  credentials: AvitoCredentials,
  options: { fetchFn?: FetchFn; sleepFn?: SleepFn } = {},
): Promise<AvitoStockItem[]> {
  const token = await getAvitoStockToken(credentials, options);
  const { items } = await fetchAllAvitoItems(token, options);
  const ids = items.map((item) => String(item.id)).filter(Boolean);
  const stocks = ids.length ? await fetchAvitoStocksInfo(token, ids, options) : new Map();

  return items.map((item) => {
    const itemId = String(item.id);
    const stock = stocks.get(itemId);
    return {
      itemId,
      title: item.title ?? item.name ?? `Avito ${itemId}`,
      price: getPrice(item.price),
      url: item.url ?? null,
      status: item.status ?? null,
      imageUrl: findFirstImageUrl(item),
      quantity: typeof stock?.quantity === "number" ? stock.quantity : null,
      isUnlimited: Boolean(stock?.is_unlimited),
      isOutOfStock: Boolean(stock?.is_out_of_stock),
      isMultiple: Boolean(stock?.is_multiple),
    };
  });
}

export async function updateAvitoStocks(
  credentials: AvitoCredentials,
  updates: AvitoStockUpdate[],
  options: { fetchFn?: FetchFn; sleepFn?: SleepFn } = {},
): Promise<StockUpdateResult[]> {
  const token = await getAvitoStockToken(credentials, options);
  const chunkSize = 200;
  const result: StockUpdateResult[] = [];

  for (let i = 0; i < updates.length; i += chunkSize) {
    const chunk = updates.slice(i, i + chunkSize);
    const response = await fetchWithRetry(
      "https://api.avito.ru/stock-management/1/stocks",
      {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          stocks: chunk.map((update) => ({
            item_id: Number(update.itemId),
            quantity: update.quantity,
          })),
        }),
        cache: "no-store",
        signal: AbortSignal.timeout(30_000),
      },
      options,
    );

    const data = (await readJsonResponse(response)) as { stocks?: StockUpdateResult[] };
    if (!response.ok) {
      throw new Error(`Обновление остатков Avito не прошло: ${extractAvitoErrorText(data).slice(0, 300)}`);
    }

    result.push(...(data.stocks ?? []));
    if (i + chunkSize < updates.length) await (options.sleepFn ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms))))(100);
  }

  return result;
}
