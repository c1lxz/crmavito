import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const ORDER_1 = "11111111-1111-4111-8111-111111111111";
const ORDER_2 = "22222222-2222-4222-8222-222222222222";
const RETURN_1 = "33333333-3333-4333-8333-333333333333";
const RETURN_2 = "44444444-4444-4444-8444-444444444444";

const mocks = vi.hoisted(() => {
  const tx = {
    order: {
      findMany: vi.fn(),
      updateMany: vi.fn(),
    },
    orderItem: {
      updateMany: vi.fn(),
    },
    return: {
      findMany: vi.fn(),
      deleteMany: vi.fn(),
    },
  };
  return {
    auth: vi.fn(),
    createAuditLog: vi.fn(),
    tx,
    prisma: {
      $transaction: vi.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
    },
  };
});

vi.mock("@/lib/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/db/prisma", () => ({ prisma: mocks.prisma }));
vi.mock("@/lib/db/audit", () => ({ createAuditLog: mocks.createAuditLog }));

import { POST as deleteOrders } from "@/app/api/orders/bulk-delete/route";
import { POST as deleteReturns } from "@/app/api/returns/bulk-delete/route";

describe("bulk deletion", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.mockResolvedValue({ user: { id: "user-1" } });
    mocks.tx.order.updateMany.mockResolvedValue({ count: 2 });
    mocks.tx.orderItem.updateMany.mockResolvedValue({ count: 1 });
    mocks.tx.return.deleteMany.mockResolvedValue({ count: 2 });
  });

  it("soft-deletes selected orders so report queries exclude them", async () => {
    mocks.tx.order.findMany.mockResolvedValue([{ id: ORDER_1 }, { id: ORDER_2 }]);

    const response = await deleteOrders(
      new NextRequest("http://localhost/api/orders/bulk-delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderIds: [ORDER_1, ORDER_2] }),
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ success: true, deletedCount: 2 });
    expect(mocks.tx.order.updateMany).toHaveBeenCalledWith({
      where: { id: { in: [ORDER_1, ORDER_2] }, isDeleted: false },
      data: { isDeleted: true },
    });
    expect(mocks.createAuditLog).toHaveBeenCalledTimes(2);
  });

  it("returns reserved warehouse goods when an unshipped order is deleted", async () => {
    mocks.tx.order.findMany.mockResolvedValue([
      { id: ORDER_1, status: "ACCEPTED" },
      { id: ORDER_2, status: "SHIPPED" },
    ]);

    const response = await deleteOrders(
      new NextRequest("http://localhost/api/orders/bulk-delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderIds: [ORDER_1, ORDER_2] }),
      }),
    );

    expect(response.status).toBe(200);
    expect(mocks.tx.orderItem.updateMany).toHaveBeenCalledWith({
      where: {
        orderId: { in: [ORDER_1] },
        sourceReturnId: { not: null },
      },
      data: { sourceReturnId: null },
    });
  });

  it("does not partially delete orders when one selection is missing", async () => {
    mocks.tx.order.findMany.mockResolvedValue([{ id: ORDER_1 }]);

    const response = await deleteOrders(
      new NextRequest("http://localhost/api/orders/bulk-delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderIds: [ORDER_1, ORDER_2] }),
      }),
    );

    expect(response.status).toBe(404);
    expect(mocks.tx.order.updateMany).not.toHaveBeenCalled();
  });

  it("physically deletes returns and detaches deposit references first", async () => {
    mocks.tx.return.findMany.mockResolvedValue([{ id: RETURN_1 }, { id: RETURN_2 }]);

    const response = await deleteReturns(
      new NextRequest("http://localhost/api/returns/bulk-delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ returnIds: [RETURN_1, RETURN_2] }),
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ success: true, deletedCount: 2 });
    expect(mocks.tx.orderItem.updateMany).toHaveBeenCalledWith({
      where: { sourceReturnId: { in: [RETURN_1, RETURN_2] } },
      data: { sourceReturnId: null },
    });
    expect(mocks.tx.return.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: [RETURN_1, RETURN_2] } },
    });
  });

  it("rejects an empty deletion request", async () => {
    const response = await deleteReturns(
      new NextRequest("http://localhost/api/returns/bulk-delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ returnIds: [] }),
      }),
    );

    expect(response.status).toBe(400);
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
  });
});
