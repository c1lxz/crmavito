import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  transaction: vi.fn(),
  findMany: vi.fn(),
  orderUpdate: vi.fn(),
  returnFindFirst: vi.fn(),
  returnUpdate: vi.fn(),
  returnCreate: vi.fn(),
  returnUpdateMany: vi.fn(),
  createAuditLog: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/db/prisma", () => ({
  prisma: { $transaction: mocks.transaction },
}));
vi.mock("@/lib/db/audit", () => ({ createAuditLog: mocks.createAuditLog }));

import { POST } from "@/app/api/orders/bulk-status/route";

describe("POST /api/orders/bulk-status", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.mockResolvedValue({ user: { id: "user-1" } });
    mocks.findMany.mockResolvedValue([
      {
        id: "order-1",
        status: "ACCEPTED",
        productId: "product-1",
        trackingNumber: "TRACK-1",
        shippingDate: null,
      },
      {
        id: "order-2",
        status: "SHIPPED",
        productId: "product-2",
        trackingNumber: "TRACK-2",
        shippingDate: new Date("2026-07-01"),
      },
    ]);
    mocks.transaction.mockImplementation(async (callback) =>
      callback({
        order: {
          findMany: mocks.findMany,
          update: mocks.orderUpdate,
        },
        return: {
          findFirst: mocks.returnFindFirst,
          update: mocks.returnUpdate,
          create: mocks.returnCreate,
          updateMany: mocks.returnUpdateMany,
        },
      }),
    );
  });

  it("updates every selected order and writes an audit entry", async () => {
    const response = await POST(
      new NextRequest("http://localhost/api/orders/bulk-status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orderIds: ["order-1", "order-2"],
          status: "RECEIVED",
        }),
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      success: true,
      updatedCount: 2,
    });
    expect(mocks.orderUpdate).toHaveBeenCalledTimes(2);
    expect(mocks.orderUpdate).toHaveBeenCalledWith({
      where: { id: "order-1" },
      data: {
        status: "RECEIVED",
        receivedAt: expect.any(Date),
      },
    });
    expect(mocks.createAuditLog).toHaveBeenCalledTimes(2);
  });

  it("does not update anything when one of the selected orders is missing", async () => {
    mocks.findMany.mockResolvedValueOnce([
      {
        id: "order-1",
        status: "ACCEPTED",
        productId: "product-1",
        trackingNumber: "TRACK-1",
        shippingDate: null,
      },
    ]);

    const response = await POST(
      new NextRequest("http://localhost/api/orders/bulk-status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orderIds: ["order-1", "missing"],
          status: "CANCELLED",
        }),
      }),
    );

    expect(response.status).toBe(404);
    expect(mocks.orderUpdate).not.toHaveBeenCalled();
    expect(mocks.createAuditLog).not.toHaveBeenCalled();
  });

  it("rejects an empty selection", async () => {
    const response = await POST(
      new NextRequest("http://localhost/api/orders/bulk-status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderIds: [], status: "RECEIVED" }),
      }),
    );

    expect(response.status).toBe(400);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
});
