import { prisma } from "@/lib/db/prisma";
import { downloadImageAsBuffer, resolveProductImage } from "@/lib/avito/fetch-image";
import {
  sendOrderToGroup,
  type NotificationItem,
  type OrderNotification,
} from "@/lib/telegram/notify";

const PROCESSING_TIMEOUT_MS = 5 * 60_000;
const MAX_RETRY_DELAY_MS = 10 * 60_000;

export function getNotificationRetryDelay(attempt: number): number {
  return Math.min(15_000 * 2 ** Math.max(0, attempt - 1), MAX_RETRY_DELAY_MS);
}

async function resolveImageWithRetry(product: {
  avitoItemId: string | null;
  avitoListingUrl: string | null;
}) {
  let result = await resolveProductImage(product);
  for (let attempt = 1; !result.ok && attempt < 3; attempt++) {
    result = await resolveProductImage(product);
  }
  return result;
}

async function ensureItemImages(
  item: {
    id?: string;
    imageUrls: string[];
    product: {
      id: string;
      imageUrl: string | null;
      avitoItemId: string | null;
      avitoListingUrl: string | null;
    };
  },
  forceRefresh = false
): Promise<string[]> {
  if (!forceRefresh && item.imageUrls.length > 0) return item.imageUrls;

  if (!forceRefresh && item.product.imageUrl) {
    const cached = await downloadImageAsBuffer(item.product.imageUrl);
    if (cached?.length) return [item.product.imageUrl];
  }

  if (item.product.avitoItemId || item.product.avitoListingUrl) {
    const result = await resolveImageWithRetry(item.product);
    if (result.ok) {
      await prisma.product
        .update({ where: { id: item.product.id }, data: { imageUrl: result.value } })
        .catch(() => null);
      if (item.id) {
        await prisma.orderItem
          .update({ where: { id: item.id }, data: { imageUrls: [result.value] } })
          .catch(() => null);
      }
      return [result.value];
    }
  }

  return item.imageUrls;
}

async function buildOrderNotification(
  orderId: string,
  forceRefreshImages = false
): Promise<OrderNotification> {
  const order = await prisma.order.findUniqueOrThrow({
    where: { id: orderId },
    include: {
      product: true,
      counterparty: true,
      items: { include: { product: true }, orderBy: { position: "asc" } },
    },
  });

  const sourceItems =
    order.items.length > 0
      ? order.items
      : [
          {
            id: undefined,
            productNameSnapshot: order.productNameSnapshot,
            variant: order.variant,
            size: order.size,
            quantity: order.quantity,
            salePriceAtOrder: order.salePriceAtOrder,
            imageUrls: order.product.imageUrl ? [order.product.imageUrl] : [],
            product: order.product,
          },
        ];

  const items: NotificationItem[] = await Promise.all(
    sourceItems.map(async (item) => ({
      productName: item.productNameSnapshot,
      variant: item.variant,
      size: item.size,
      quantity: item.quantity,
      salePrice: Number(item.salePriceAtOrder),
      imageUrls: await ensureItemImages(item, forceRefreshImages),
    }))
  );

  return {
    orderNumber: order.orderNumber,
    items,
    trackingNumber: order.trackingNumber,
    carrier: order.carrier ?? "",
    counterpartyName: order.counterparty.name,
    orderDate: order.orderDate,
  };
}

async function claimNotification(notificationId: string) {
  const now = new Date();
  const claimed = await prisma.orderNotification.updateMany({
    where: {
      id: notificationId,
      status: { in: ["PENDING", "RETRY"] },
      nextAttemptAt: { lte: now },
    },
    data: {
      status: "PROCESSING",
      processingStartedAt: now,
    },
  });
  if (claimed.count !== 1) return null;
  return prisma.orderNotification.findUnique({
    where: { id: notificationId },
    include: { order: { select: { isDeleted: true } } },
  });
}

export async function processOrderNotification(notificationId: string): Promise<boolean> {
  const notification = await claimNotification(notificationId);
  if (!notification) return false;

  if (notification.order.isDeleted) {
    await prisma.orderNotification.update({
      where: { id: notification.id },
      data: {
        status: "CANCELLED",
        lastError: "Заказ удалён до отправки уведомления",
        processingStartedAt: null,
      },
    });
    return false;
  }

  try {
    let payload = await buildOrderNotification(notification.orderId);
    try {
      await sendOrderToGroup(payload, {
        startBatch: notification.sentBatches,
        onBatchSent: async (sentBatches) => {
          await prisma.orderNotification.update({
            where: { id: notification.id },
            data: { sentBatches },
          });
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!message.includes("Не удалось скачать фото товара")) throw error;
      payload = await buildOrderNotification(notification.orderId, true);
      await sendOrderToGroup(payload, {
        startBatch: notification.sentBatches,
        onBatchSent: async (sentBatches) => {
          await prisma.orderNotification.update({
            where: { id: notification.id },
            data: { sentBatches },
          });
        },
      });
    }

    await prisma.orderNotification.update({
      where: { id: notification.id },
      data: {
        status: "SENT",
        sentAt: new Date(),
        lastError: null,
        processingStartedAt: null,
      },
    });
    return true;
  } catch (error) {
    const attempts = notification.attempts + 1;
    const message = error instanceof Error ? error.message : String(error);
    console.error(
      `[telegram-queue] order ${notification.orderId}, attempt ${attempts}: ${message}`
    );
    await prisma.orderNotification.update({
      where: { id: notification.id },
      data: {
        status: "RETRY",
        attempts,
        nextAttemptAt: new Date(Date.now() + getNotificationRetryDelay(attempts)),
        lastError: message.slice(0, 1000),
        processingStartedAt: null,
      },
    });
    return false;
  }
}

export async function processOrderNotificationByOrderId(orderId: string): Promise<boolean> {
  const notification = await prisma.orderNotification.findUnique({
    where: { orderId },
    select: { id: true },
  });
  return notification ? processOrderNotification(notification.id) : false;
}

export async function processPendingOrderNotifications(limit = 10): Promise<number> {
  const now = new Date();
  await prisma.orderNotification.updateMany({
    where: {
      status: "PROCESSING",
      processingStartedAt: {
        lt: new Date(now.getTime() - PROCESSING_TIMEOUT_MS),
      },
    },
    data: {
      status: "RETRY",
      nextAttemptAt: now,
      processingStartedAt: null,
      lastError: "Повтор после прерванной обработки",
    },
  });

  const pending = await prisma.orderNotification.findMany({
    where: {
      status: { in: ["PENDING", "RETRY"] },
      nextAttemptAt: { lte: now },
    },
    orderBy: { createdAt: "asc" },
    take: limit,
    select: { id: true },
  });

  let sent = 0;
  for (const notification of pending) {
    if (await processOrderNotification(notification.id)) sent++;
  }
  return sent;
}
