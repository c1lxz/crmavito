const WB_STICKERS_URL =
  "https://marketplace-api.wildberries.ru/api/v3/orders/stickers?type=png&width=40&height=30";
const WB_ORDER_ID_PATTERN = /^\d{1,20}$/;

interface WbStickerResponse {
  stickers?: Array<{
    barcode?: string;
    file?: string;
  }>;
  code?: string;
  message?: string;
}

export async function fetchWbOrderStickerBarcode(
  orderId: string,
  options: {
    token?: string;
    fetchFn?: typeof fetch;
  } = {},
): Promise<string> {
  const normalizedOrderId = orderId.trim();
  if (!WB_ORDER_ID_PATTERN.test(normalizedOrderId)) {
    throw new Error("Для QR WB нужен числовой ID сборочного задания");
  }

  const token =
    options.token?.trim() ||
    process.env.WB_MARKETPLACE_API_TOKEN?.trim() ||
    process.env.WB_API_TOKEN?.trim();
  if (!token) {
    throw new Error("Не задан WB_MARKETPLACE_API_TOKEN для получения QR WB");
  }

  const response = await (options.fetchFn ?? fetch)(WB_STICKERS_URL, {
    method: "POST",
    headers: {
      Authorization: token,
      "Content-Type": "application/json",
    },
    // Keep the int64 ID outside JavaScript Number to avoid precision loss.
    body: `{"orders":[${normalizedOrderId}]}`,
    signal: AbortSignal.timeout(15_000),
  });
  const payload = (await response.json().catch(() => ({}))) as WbStickerResponse;
  if (!response.ok) {
    throw new Error(
      `WB API: ${payload.message || payload.code || `HTTP ${response.status}`}`,
    );
  }

  const barcode = payload.stickers?.[0]?.barcode?.trim();
  if (!barcode) {
    throw new Error("WB API не вернул код стикера для этого заказа");
  }
  return barcode;
}
