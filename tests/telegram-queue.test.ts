import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  sendOrderToGroup: vi.fn(),
  downloadImageAsBuffer: vi.fn(),
  resolveProductImage: vi.fn(),
  prisma: {
    orderNotification: {
      updateMany: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
    },
    order: {
      findUniqueOrThrow: vi.fn(),
    },
    product: {
      update: vi.fn(),
    },
    orderItem: {
      update: vi.fn(),
    },
  },
}));

vi.mock("@/lib/db/prisma", () => ({ prisma: mocks.prisma }));
vi.mock("@/lib/telegram/notify", () => ({
  sendOrderToGroup: mocks.sendOrderToGroup,
}));
vi.mock("@/lib/avito/fetch-image", () => ({
  downloadImageAsBuffer: mocks.downloadImageAsBuffer,
  resolveProductImage: mocks.resolveProductImage,
}));

import {
  getNotificationRetryDelay,
  processOrderNotification,
} from "@/lib/telegram/order-notification-queue";

const claimedNotification = {
  id: "notification-1",
  orderId: "order-1",
  status: "PROCESSING",
  attempts: 0,
  sentBatches: 0,
  order: { isDeleted: false },
};

const order = {
  id: "order-1",
  orderNumber: "0001",
  productNameSnapshot: "Товар",
  variant: null,
  size: null,
  quantity: 1,
  salePriceAtOrder: 2500,
  trackingNumber: "TRACK",
  carrier: "СДЭК",
  orderDate: new Date("2026-07-01"),
  counterparty: { name: "Поставщик" },
  product: {
    id: "product-1",
    imageUrl: null,
    avitoItemId: null,
    avitoListingUrl: null,
  },
  items: [
    {
      id: "item-1",
      productNameSnapshot: "Товар",
      variant: null,
      size: null,
      quantity: 1,
      salePriceAtOrder: 2500,
      imageUrls: ["/uploads/orders/photo.jpg"],
      product: {
        id: "product-1",
        imageUrl: null,
        avitoItemId: null,
        avitoListingUrl: null,
      },
    },
  ],
};

describe("durable Telegram order queue", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.prisma.orderNotification.updateMany.mockResolvedValue({ count: 1 });
    mocks.prisma.orderNotification.findUnique.mockResolvedValue(claimedNotification);
    mocks.prisma.order.findUniqueOrThrow.mockResolvedValue(order);
    mocks.prisma.orderNotification.update.mockResolvedValue({});
  });

  it("marks a notification sent and checkpoints every Telegram media batch", async () => {
    mocks.sendOrderToGroup.mockImplementation(async (_payload, options) => {
      await options.onBatchSent(1);
      return 1;
    });

    await expect(processOrderNotification("notification-1")).resolves.toBe(true);

    expect(mocks.prisma.orderNotification.update).toHaveBeenCalledWith({
      where: { id: "notification-1" },
      data: { sentBatches: 1 },
    });
    expect(mocks.prisma.orderNotification.update).toHaveBeenLastCalledWith({
      where: { id: "notification-1" },
      data: expect.objectContaining({
        status: "SENT",
        sentAt: expect.any(Date),
        lastError: null,
      }),
    });
  });

  it("stores a failed attempt for automatic retry instead of losing the order", async () => {
    mocks.sendOrderToGroup.mockRejectedValue(new Error("Telegram HTTP 500"));

    await expect(processOrderNotification("notification-1")).resolves.toBe(false);

    expect(mocks.prisma.orderNotification.update).toHaveBeenLastCalledWith({
      where: { id: "notification-1" },
      data: expect.objectContaining({
        status: "RETRY",
        attempts: 1,
        nextAttemptAt: expect.any(Date),
        lastError: "Telegram HTTP 500",
      }),
    });
  });

  it("does not send the same notification concurrently when claim fails", async () => {
    mocks.prisma.orderNotification.updateMany.mockResolvedValue({ count: 0 });

    await expect(processOrderNotification("notification-1")).resolves.toBe(false);
    expect(mocks.sendOrderToGroup).not.toHaveBeenCalled();
  });

  it("backs off retries but never stops retrying permanently", () => {
    expect(getNotificationRetryDelay(1)).toBe(15_000);
    expect(getNotificationRetryDelay(2)).toBe(30_000);
    expect(getNotificationRetryDelay(20)).toBe(10 * 60_000);
  });
});
