import bwipjs from "bwip-js/node";
import { downloadImageAsBuffer } from "@/lib/avito/fetch-image";

export interface NotificationItem {
  productName: string;
  variant: string | null;
  size: string | null;
  quantity: number;
  salePrice: number;
  imageUrls: string[];
}

export interface OrderNotification {
  orderNumber: string;
  items: NotificationItem[];
  trackingNumber: string;
  carrier: string;
  counterpartyName: string;
  orderDate: Date;
}

export function buildOrderCaption(order: {
  trackingNumber: string;
  carrier: string;
  size?: string | null;
}): string {
  return [
    order.trackingNumber,
    order.carrier || null,
    order.size ? order.size.toUpperCase() : null,
  ]
    .filter(Boolean)
    .join("\n");
}

async function generateBarcodePng(text: string): Promise<Buffer> {
  try {
    return (await bwipjs.toBuffer({
      bcid: "code128",
      text,
      scale: 3,
      height: 18,
      includetext: true,
      textxalign: "center",
      paddingwidth: 10,
      paddingheight: 10,
      backgroundcolor: "FFFFFF",
    })) as Buffer;
  } catch (error) {
    console.error("[telegram] barcode gen failed", error);
    throw error;
  }
}

async function tgFetch(token: string, method: string, form: FormData): Promise<unknown> {
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    body: form,
    signal: AbortSignal.timeout(15_000),
  });
  const json = (await response.json().catch(() => ({}))) as {
    ok?: boolean;
    description?: string;
  };
  if (!response.ok || !json.ok) {
    console.error(
      `[telegram] ${method} failed: HTTP ${response.status} — ${json.description ?? "unknown"}`
    );
    throw new Error(json.description ?? `HTTP ${response.status}`);
  }
  return json;
}

async function downloadRequiredImage(url: string): Promise<Buffer> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const image = await downloadImageAsBuffer(url);
    if (image?.length) return image;
  }
  throw new Error(`Не удалось скачать фото товара: ${url.slice(0, 120)}`);
}

export async function sendOrderToGroup(
  order: OrderNotification,
  options?: {
    startBatch?: number;
    onBatchSent?: (sentBatchCount: number) => Promise<void>;
  }
): Promise<number> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_GROUP_CHAT_ID;
  if (!token || !chatId) {
    throw new Error("TELEGRAM_BOT_TOKEN or TELEGRAM_GROUP_CHAT_ID not set");
  }

  const caption = buildOrderCaption({
    trackingNumber: order.trackingNumber,
    carrier: order.carrier,
    size: order.items.length === 1 ? order.items[0].size : null,
  });
  const imageUrls = order.items.flatMap((item) => item.imageUrls);
  const [barcode, ...downloadedImages] = await Promise.all([
    generateBarcodePng(order.trackingNumber),
    ...imageUrls.map(downloadRequiredImage),
  ]);
  const productImages = downloadedImages;

  const allImages = [
      ...productImages.map((image, index) => ({
        image,
        filename: `product-${index + 1}.jpg`,
        contentType: "image/jpeg",
        isLast: false,
      })),
      {
        image: barcode,
        filename: "barcode.png",
        contentType: "image/png",
        isLast: true,
      },
    ];
    const batches = Array.from(
      { length: Math.ceil(allImages.length / 10) },
      (_, index) => allImages.slice(index * 10, index * 10 + 10)
    );
    const startBatch = Math.min(options?.startBatch ?? 0, batches.length);

    for (let batchIndex = startBatch; batchIndex < batches.length; batchIndex++) {
      const batch = batches[batchIndex];
      if (batch.length === 1) {
        const form = new FormData();
        form.append("chat_id", chatId);
        form.append(
          "photo",
          new Blob([new Uint8Array(batch[0].image)], { type: batch[0].contentType }),
          batch[0].filename
        );
        if (batch[0].isLast) form.append("caption", caption);
        await tgFetch(token, "sendPhoto", form);
        await options?.onBatchSent?.(batchIndex + 1);
        continue;
      }

      const form = new FormData();
      form.append("chat_id", chatId);
      form.append(
        "media",
        JSON.stringify(
          batch.map((item, index) => ({
            type: "photo",
            media: `attach://image${index}`,
            ...(item.isLast ? { caption } : {}),
          }))
        )
      );
      batch.forEach((item, index) => {
        form.append(
          `image${index}`,
          new Blob([new Uint8Array(item.image)], { type: item.contentType }),
          item.filename
        );
      });
      await tgFetch(token, "sendMediaGroup", form);
      await options?.onBatchSent?.(batchIndex + 1);
    }
    return batches.length;
}
