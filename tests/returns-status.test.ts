import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => {
  const tx = {
    order: {
      findUniqueOrThrow: vi.fn(),
      update: vi.fn(),
    },
    return: {
      update: vi.fn(),
      findMany: vi.fn(),
      updateMany: vi.fn(),
    },
  };

  return {
    auth: vi.fn(),
    createAuditLog: vi.fn(),
    tx,
    prisma: {
      return: {
        findUnique: vi.fn(),
      },
      $transaction: vi.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
    },
  };
});

vi.mock("@/lib/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/db/prisma", () => ({ prisma: mocks.prisma }));
vi.mock("@/lib/db/audit", () => ({ createAuditLog: mocks.createAuditLog }));

import { PATCH } from "@/app/api/returns/[id]/route";
import { transitionOrderStatus } from "@/lib/db/orders";

describe("return status updates", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.mockResolvedValue({ user: { id: "user-1" } });
    mocks.prisma.return.findUnique.mockResolvedValue({
      id: "return-1",
      orderId: "order-1",
      status: "RETURNING",
      order: { status: "RETURNING", receivedAt: new Date("2026-06-20") },
    });
    mocks.tx.return.update.mockResolvedValue({});
    mocks.tx.order.update.mockResolvedValue({});
  });

  it("marks the return and order as returned without violating the audit foreign key", async () => {
    const response = await PATCH(
      new NextRequest("http://localhost/api/returns/return-1", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "RETURNED", returnDate: "2026-06-30" }),
      }),
      { params: Promise.resolve({ id: "return-1" }) }
    );

    expect(response.status).toBe(200);
    expect(mocks.tx.return.update).toHaveBeenCalledWith({
      where: { id: "return-1" },
      data: {
        status: "RETURNED",
        returnDate: new Date("2026-06-30T12:00:00+03:00"),
      },
    });
    expect(mocks.tx.order.update).toHaveBeenCalledWith({
      where: { id: "order-1" },
      data: { status: "RETURNED" },
    });
    expect(mocks.createAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        entityType: "RETURN",
        entityId: "order-1",
        oldValue: "RETURNING",
        newValue: "RETURNED",
      }),
      mocks.tx
    );
  });

  it("cancels a return and restores the received order status", async () => {
    const response = await PATCH(
      new NextRequest("http://localhost/api/returns/return-1", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "CANCELLED" }),
      }),
      { params: Promise.resolve({ id: "return-1" }) }
    );

    expect(response.status).toBe(200);
    expect(mocks.tx.return.update).toHaveBeenCalledWith({
      where: { id: "return-1" },
      data: { status: "CANCELLED", returnDate: null },
    });
    expect(mocks.tx.order.update).toHaveBeenCalledWith({
      where: { id: "order-1" },
      data: { status: "RECEIVED" },
    });
  });

  it("restores SHIPPED when a return started before the order was received", async () => {
    mocks.prisma.return.findUnique.mockResolvedValue({
      id: "return-1",
      orderId: "order-1",
      status: "RETURNING",
      order: { status: "RETURNING", receivedAt: null },
    });

    const response = await PATCH(
      new NextRequest("http://localhost/api/returns/return-1", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "CANCELLED" }),
      }),
      { params: Promise.resolve({ id: "return-1" }) }
    );

    expect(response.status).toBe(200);
    expect(mocks.tx.order.update).toHaveBeenCalledWith({
      where: { id: "order-1" },
      data: { status: "SHIPPED" },
    });
  });

  it("rejects repeated changes to a completed return", async () => {
    mocks.prisma.return.findUnique.mockResolvedValue({
      id: "return-1",
      orderId: "order-1",
      status: "RETURNED",
      order: { status: "RETURNED", receivedAt: new Date() },
    });

    const response = await PATCH(
      new NextRequest("http://localhost/api/returns/return-1", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "CANCELLED" }),
      }),
      { params: Promise.resolve({ id: "return-1" }) }
    );

    expect(response.status).toBe(409);
    expect(mocks.tx.return.update).not.toHaveBeenCalled();
  });

  it("keeps an open return in sync when the order is marked returned", async () => {
    mocks.tx.order.findUniqueOrThrow.mockResolvedValue({
      id: "order-1",
      status: "RETURNING",
    });
    mocks.tx.order.update.mockResolvedValue({
      id: "order-1",
      status: "RETURNED",
    });
    mocks.tx.return.findMany.mockResolvedValue([{ id: "return-1" }]);
    mocks.tx.return.updateMany.mockResolvedValue({ count: 1 });

    await transitionOrderStatus("order-1", "RETURNED", "user-1");

    expect(mocks.tx.return.updateMany).toHaveBeenCalledWith({
      where: { orderId: "order-1", status: "RETURNING" },
      data: {
        status: "RETURNED",
        returnDate: expect.any(Date),
      },
    });
    expect(mocks.createAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        entityType: "RETURN",
        entityId: "order-1",
        oldValue: "RETURNING",
        newValue: "RETURNED",
      }),
      mocks.tx
    );
  });
});
