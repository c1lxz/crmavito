import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const PRODUCT_ID = "11111111-1111-4111-8111-111111111111";

const mocks = vi.hoisted(() => {
  const tx = {
    return: { create: vi.fn() },
    order: { update: vi.fn() },
    orderItem: { updateMany: vi.fn() },
  };

  return {
    auth: vi.fn(),
    createAuditLog: vi.fn(),
    tx,
    prisma: {
      order: { findFirst: vi.fn() },
      product: { findUnique: vi.fn() },
      return: { findFirst: vi.fn() },
      $transaction: vi.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
    },
  };
});

vi.mock("@/lib/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/db/prisma", () => ({ prisma: mocks.prisma }));
vi.mock("@/lib/db/audit", () => ({ createAuditLog: mocks.createAuditLog }));

import { POST } from "@/app/api/returns/route";

function request() {
  return new NextRequest("http://localhost/api/returns", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      trackingNumber: "TRACK-100",
      productId: PRODUCT_ID,
      productNameSnapshot: "Товар",
      shippingDate: "2026-07-20",
      reason: "Возврат получен",
    }),
  });
}

describe("return creation status", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-27T10:00:00.000Z"));
    mocks.auth.mockResolvedValue({ user: { id: "user-1" } });
    mocks.prisma.product.findUnique.mockResolvedValue({ id: PRODUCT_ID });
    mocks.prisma.return.findFirst.mockResolvedValue(null);
    mocks.tx.return.create.mockImplementation(async ({ data }) => ({ id: "return-1", ...data }));
  });

  it("creates a completed return and never downgrades a returned order", async () => {
    mocks.prisma.order.findFirst.mockResolvedValue({
      id: "order-1",
      status: "RETURNED",
      productId: PRODUCT_ID,
      productNameSnapshot: "Товар",
      variant: null,
      size: null,
      trackingNumber: "TRACK-100",
      items: [],
    });

    const response = await POST(request());

    expect(response.status).toBe(201);
    expect(mocks.tx.return.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        orderId: "order-1",
        status: "RETURNED",
        returnDate: new Date("2026-07-27T10:00:00.000Z"),
      }),
    });
    expect(mocks.tx.order.update).not.toHaveBeenCalled();
    expect(mocks.createAuditLog).not.toHaveBeenCalled();
  });

  it("marks the matching order returned when its return card is created", async () => {
    mocks.prisma.order.findFirst.mockResolvedValue({
      id: "order-1",
      status: "SHIPPED",
      productId: PRODUCT_ID,
      productNameSnapshot: "Товар",
      variant: null,
      size: null,
      trackingNumber: "TRACK-100",
      items: [],
    });

    const response = await POST(request());

    expect(response.status).toBe(201);
    expect(mocks.tx.order.update).toHaveBeenCalledWith({
      where: { id: "order-1" },
      data: { status: "RETURNED", salePriceAtOrder: 0 },
    });
    expect(mocks.createAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        entityType: "ORDER",
        oldValue: "SHIPPED",
        newValue: "RETURNED",
      }),
      mocks.tx,
    );
  });

  it("rejects another active card with the same tracking number", async () => {
    mocks.prisma.order.findFirst.mockResolvedValue(null);
    mocks.prisma.return.findFirst.mockResolvedValue({ id: "existing-return" });

    const response = await POST(request());

    expect(response.status).toBe(409);
    expect(mocks.prisma.return.findFirst).toHaveBeenCalledWith({
      where: {
        status: { in: ["RETURNING", "RETURNED"] },
        OR: [
          {
            trackingNumber: {
              equals: "TRACK-100",
              mode: "insensitive",
            },
          },
        ],
      },
    });
    expect(mocks.tx.return.create).not.toHaveBeenCalled();
  });
});
