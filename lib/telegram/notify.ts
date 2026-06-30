import bwipjs from "bwip-js/node";
import { downloadImageAsBuffer } from "@/lib/avito/fetch-image";

interface OrderNotification {
  orderNumber: string;
  productName: string;
  variant: string | null;
  size: string | null;
  quantity: number;
  salePrice: number;
  trackingNumber: string;
  carrier: string;
  counterpartyName: string;
  productImageUrl?: string | null;
  orderDate: Date;
}

export function buildOrderCaption(order: Pick<OrderNotification, "trackingNumber" | "carrier" | "size">): string {
  return [
    order.trackingNumber,
    order.carrier || null,
    order.size ? order.size.toUpperCase() : null,
  ]
    .filter(Boolean)
    .join("\n");
}

async function generateBarcodePng(text: string): Promise<Buffer | null> {
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
  } catch (e) {
    console.error("[telegram] barcode gen failed", e);
    return null;
  }
}

async function tgFetch(token: string, method: string, form: FormData): Promise<unknown> {
  const r = await fetch(`https://api.telegram.org/bot${token}/${method}`, { method: "POST", body: form });
  const json = (await r.json().catch(() => ({}))) as { ok?: boolean; description?: string };
  if (!r.ok || !json.ok) {
    console.error(`[telegram] ${method} failed: HTTP ${r.status} — ${json.description ?? "unknown"}`);
    throw new Error(json.description ?? `HTTP ${r.status}`);
  }
  return json;
}

export async function sendOrderToGroup(order: OrderNotification): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_GROUP_CHAT_ID;
  if (!token || !chatId) {
    console.warn("[telegram] TELEGRAM_BOT_TOKEN or TELEGRAM_GROUP_CHAT_ID not set, skip notify");
    return;
  }

  const caption = buildOrderCaption(order);

  const [barcode, productImage] = await Promise.all([
    generateBarcodePng(order.trackingNumber),
    order.productImageUrl ? downloadImageAsBuffer(order.productImageUrl) : Promise.resolve(null),
  ]);

  try {
    if (productImage && barcode) {
      const form = new FormData();
      form.append("chat_id", chatId);
      form.append(
        "media",
        JSON.stringify([
          { type: "photo", media: "attach://product" },
          { type: "photo", media: "attach://barcode", caption },
        ])
      );
      form.append("product", new Blob([new Uint8Array(productImage)], { type: "image/jpeg" }), "product.jpg");
      form.append("barcode", new Blob([new Uint8Array(barcode)], { type: "image/png" }), "barcode.png");
      await tgFetch(token, "sendMediaGroup", form);
      return;
    }

    if (productImage) {
      const form = new FormData();
      form.append("chat_id", chatId);
      form.append("photo", new Blob([new Uint8Array(productImage)], { type: "image/jpeg" }), "product.jpg");
      form.append("caption", caption);
      await tgFetch(token, "sendPhoto", form);
      return;
    }

    if (barcode) {
      const form = new FormData();
      form.append("chat_id", chatId);
      form.append("photo", new Blob([new Uint8Array(barcode)], { type: "image/png" }), "barcode.png");
      form.append("caption", caption);
      await tgFetch(token, "sendPhoto", form);
      return;
    }

    const form = new FormData();
    form.append("chat_id", chatId);
    form.append("text", caption);
    await tgFetch(token, "sendMessage", form);
  } catch (e) {
    console.error("[telegram] sendOrderToGroup failed", e);
  }
}
