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
  sizes?: Array<string | null>;
}): string {
  const sizes = (order.sizes ?? [order.size])
    .filter((size): size is string => Boolean(size?.trim()))
    .map((size) => size.trim().toUpperCase());
  return [
    order.trackingNumber,
    order.carrier || null,
    ...sizes,
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

async function tgJsonFetch<T>(
  token: string,
  method: string,
  body: Record<string, unknown>
): Promise<T> {
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  const json = (await response.json().catch(() => ({}))) as {
    ok?: boolean;
    description?: string;
    result?: T;
  };
  if (!response.ok || !json.ok) {
    console.error(
      `[telegram] ${method} failed: HTTP ${response.status} - ${json.description ?? "unknown"}`
    );
    throw new Error(json.description ?? `HTTP ${response.status}`);
  }
  return json.result as T;
}

export interface TaskNotificationPayload {
  taskId: string;
  title: string;
  description: string | null;
  dueAt: Date;
  assigneeTelegramId: string;
}

function formatTaskDate(date: Date): string {
  return date.toLocaleString("ru-RU", {
    timeZone: "Europe/Moscow",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function buildTaskMessage(task: TaskNotificationPayload): string {
  return [
    `Задача: ${task.title}`,
    task.description ? `Описание: ${task.description}` : null,
    `⏰ Дедлайн: ${formatTaskDate(task.dueAt)}`,
  ]
    .filter(Boolean)
    .join("\n");
}

export async function sendTaskNotification(task: TaskNotificationPayload): Promise<{
  chatId: string;
  messageId: number;
}> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN not set");

  const result = await tgJsonFetch<{ message_id: number; chat: { id: number | string } }>(
    token,
    "sendMessage",
    {
      chat_id: task.assigneeTelegramId,
      text: buildTaskMessage(task),
      disable_web_page_preview: true,
      reply_markup: {
        inline_keyboard: [
          [{ text: "Готово", callback_data: `task_done:${task.taskId}` }],
        ],
      },
    }
  );

  return {
    chatId: String(result.chat.id),
    messageId: result.message_id,
  };
}

export async function sendTaskCompletedToAdmin(options: {
  adminTelegramId: string;
  title: string;
  description: string | null;
  dueAt: Date;
  completedAt: Date;
  assigneeNames: string[];
  completedByName: string | null;
}): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN not set");

  await tgJsonFetch(token, "sendMessage", {
    chat_id: options.adminTelegramId,
    text: [
      `Задача выполнена: ${options.title}`,
      options.description ? `Описание: ${options.description}` : null,
      `⏰ Срок: ${formatTaskDate(options.dueAt)}`,
      `Ответственный: ${options.assigneeNames.join(", ")}`,
      options.completedByName ? `Выполнил: ${options.completedByName}` : null,
      `Выполнено: ${formatTaskDate(options.completedAt)}`,
    ]
      .filter(Boolean)
      .join("\n"),
    disable_web_page_preview: true,
  });
}

export async function sendNoteMentionNotification(options: {
  recipientTelegramId: string;
  noteTitle: string;
  authorName: string;
}): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN not set");

  const baseUrl = (process.env.NEXTAUTH_URL || "https://crmavito.duckdns.org").replace(/\/$/, "");
  const noteUrl = `${baseUrl}/m/tasks`;
  await tgJsonFetch(token, "sendMessage", {
    chat_id: options.recipientTelegramId,
    text: [
      "Вас отметили в заметке",
      `«${options.noteTitle}»`,
      `Автор: ${options.authorName}`,
      "",
      "Ознакомьтесь с заметкой в блокноте.",
    ].join("\n"),
    disable_web_page_preview: true,
    reply_markup: {
      inline_keyboard: [[{ text: "Открыть блокнот", url: noteUrl }]],
    },
  });
}

export async function answerTelegramCallback(
  callbackQueryId: string,
  text: string
): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN not set");
  await tgJsonFetch(token, "answerCallbackQuery", {
    callback_query_id: callbackQueryId,
    text,
    show_alert: false,
  });
}

export async function deleteTaskNotificationMessage(
  chatId: string,
  messageId: number
): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN not set");
  await tgJsonFetch<boolean>(token, "deleteMessage", {
    chat_id: chatId,
    message_id: messageId,
  });
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
    sizes: order.items.map((item) => item.size),
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
