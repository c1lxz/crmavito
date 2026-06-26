import bwipjs from "bwip-js/node";

interface OrderNotification {
  orderNumber: string;
  productName: string;
  variant: string | null;
  quantity: number;
  salePrice: number;
  trackingNumber: string;
  carrier: string;
  counterpartyName: string;
  productImageUrl?: string | null;
  orderDate: Date;
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
  } catch {
    return null;
  }
}

function formatDate(d: Date): string {
  return d.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function formatRub(n: number): string {
  return new Intl.NumberFormat("ru-RU", { style: "currency", currency: "RUB", maximumFractionDigits: 0 }).format(n);
}

export async function sendOrderToGroup(order: OrderNotification): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_GROUP_CHAT_ID;
  if (!token || !chatId) {
    console.warn("[telegram] TELEGRAM_BOT_TOKEN or TELEGRAM_GROUP_CHAT_ID not set, skip notify");
    return;
  }

  const caption = [
    `<b>📦 Новый заказ № ${order.orderNumber}</b>`,
    `<i>${formatDate(order.orderDate)}</i>`,
    ``,
    `<b>Товар:</b> ${order.productName}`,
    order.variant ? `<b>Цвет:</b> ${order.variant}` : null,
    `<b>Количество:</b> ${order.quantity} шт.`,
    `<b>Цена:</b> ${formatRub(order.salePrice)}`,
    ``,
    `<b>Трек:</b> <code>${order.trackingNumber}</code>`,
    `<b>ТК:</b> ${order.carrier}`,
    ``,
    `<b>Поставщик:</b> ${order.counterpartyName}`,
  ]
    .filter(Boolean)
    .join("\n");

  const barcode = await generateBarcodePng(order.trackingNumber);

  try {
    if (order.productImageUrl && barcode) {
      const form = new FormData();
      form.append("chat_id", chatId);
      form.append(
        "media",
        JSON.stringify([
          { type: "photo", media: order.productImageUrl, caption, parse_mode: "HTML" },
          { type: "photo", media: "attach://barcode" },
        ])
      );
      form.append("barcode", new Blob([new Uint8Array(barcode)], { type: "image/png" }), "barcode.png");
      await fetch(`https://api.telegram.org/bot${token}/sendMediaGroup`, { method: "POST", body: form });
    } else if (barcode) {
      const form = new FormData();
      form.append("chat_id", chatId);
      form.append("photo", new Blob([new Uint8Array(barcode)], { type: "image/png" }), "barcode.png");
      form.append("caption", caption);
      form.append("parse_mode", "HTML");
      await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, { method: "POST", body: form });
    } else {
      await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text: caption, parse_mode: "HTML" }),
      });
    }
  } catch (e) {
    console.error("[telegram] sendOrderToGroup failed", e);
  }
}
