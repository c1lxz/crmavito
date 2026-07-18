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

export type AvitoStockItemsResult = {
  items: AvitoStockItem[];
  warning?: string;
};

export type AvitoStockUpdate = {
  itemId: string;
  quantity: number;
};

type FetchFn = typeof fetch;
type SleepFn = (ms: number) => Promise<void>;
type StockOptions = {
  fetchFn?: FetchFn;
  sleepFn?: SleepFn;
  pageDelayMs?: number;
  stockDelayMs?: number;
  stockDeadlineMs?: number;
  skipStocks?: boolean;
};

export type StockInfo = {
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

export type StockInfoResult = {
  stocks: Map<string, StockInfo>;
  warning?: string;
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
  options: StockOptions = {},
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
  options: StockOptions = {},
): Promise<StockInfoResult> {
  const result = new Map<string, StockInfo>();
  const chunkSize = 10;
  const chunks: string[][] = [];

  for (let i = 0; i < itemIds.length; i += chunkSize) {
    chunks.push(itemIds.slice(i, i + chunkSize));
  }

  const sleepFn = options.sleepFn ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const stockDelayMs = options.stockDelayMs ?? 300;
  const deadlineAt = Date.now() + (options.stockDeadlineMs ?? 55_000);

  async function fetchChunk(chunk: string[]): Promise<{ hasStocks: boolean; stocks: StockInfo[] }> {
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
      { ...options, attempts: 3 },
    );

    const data = (await readJsonResponse(response)) as { stocks?: StockInfo[] };
    if (!response.ok) {
      const details = extractAvitoErrorText(data).slice(0, 300);
      const reason =
        response.status === 429
          ? "Avito ограничил частоту запросов остатков"
          : response.status >= 500
            ? "Avito временно не отвечает на запрос остатков"
            : `Avito отклонил запрос остатков (${response.status})`;
      throw new Error(details && details !== "{}" ? `${reason}: ${details}` : reason);
    }

    return { hasStocks: Array.isArray(data.stocks), stocks: data.stocks ?? [] };
  }

  const first = await fetchChunk(chunks[0]);
  if (!first.hasStocks) return { stocks: result };

  for (const stock of first.stocks) result.set(String(stock.item_id), stock);

  for (const chunk of chunks.slice(1)) {
    if (Date.now() >= deadlineAt) {
      return {
        stocks: result,
        warning: `Avito не успел отдать все остатки до таймаута. Загружено остатков: ${result.size} из ${itemIds.length}.`,
      };
    }
    if (stockDelayMs > 0) await sleepFn(stockDelayMs);
    let data: { hasStocks: boolean; stocks: StockInfo[] };
    try {
      data = await fetchChunk(chunk);
    } catch (error) {
      const details = error instanceof Error ? error.message : String(error);
      return {
        stocks: result,
        warning: `Avito временно ограничил или прервал получение остатков. Загружено остатков: ${result.size} из ${itemIds.length}.${details ? ` ${details}` : ""}`,
      };
    }
    if (!data.hasStocks) {
      return {
        stocks: result,
        warning: `Avito не отдал данные остатков для части объявлений. Загружено остатков: ${result.size} из ${itemIds.length}.`,
      };
    }
    for (const stock of data.stocks) result.set(String(stock.item_id), stock);
  }

  return { stocks: result };
}

export async function fetchAvitoStockItemsResult(
  credentials: AvitoCredentials,
  options: StockOptions = {},
): Promise<AvitoStockItemsResult> {
  const token = await getAvitoStockToken(credentials, options);
  const { items } = await fetchAllAvitoItems(token, {
    ...options,
    pageDelayMs: options.pageDelayMs ?? 150,
  });
  const ids = items.map((item) => String(item.id)).filter(Boolean);
  const stockResult =
    ids.length && !options.skipStocks
      ? await fetchAvitoStocksInfo(token, ids, options)
      : { stocks: new Map<string, StockInfo>() };
  const stocks = stockResult.stocks;

  return {
    warning: stockResult.warning,
    items: items.map((item) => {
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
    }),
  };
}

export async function fetchAvitoStockItems(
  credentials: AvitoCredentials,
  options: StockOptions = {},
): Promise<AvitoStockItem[]> {
  return (await fetchAvitoStockItemsResult(credentials, options)).items;
}

export async function updateAvitoStocks(
  credentials: AvitoCredentials,
  updates: AvitoStockUpdate[],
  options: StockOptions = {},
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
