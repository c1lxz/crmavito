import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  transaction: vi.fn(),
  findMany: vi.fn(),
  orderUpdate: vi.fn(),
  orderItemUpdateMany: vi.fn(),
  returnFindFirst: vi.fn(),
  returnUpdate: vi.fn(),
  returnCreate: vi.fn(),
  returnUpdateMany: vi.fn(),
  counterpartyFindUnique: vi.fn(),
  createAuditLog: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    $transaction: mocks.transaction,
    counterparty: { findUnique: mocks.counterpartyFindUnique },
  },
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
        productNameSnapshot: "Product 1",
        variant: null,
        size: "M",
        counterpartyId: "counterparty-old",
        purchasePricePerUnit: 700,
        quantity: 1,
        items: [{ quantity: 1, sourceReturnId: null }],
        trackingNumber: "TRACK-1",
        shippingDate: null,
      },
      {
        id: "order-2",
        status: "SHIPPED",
        productId: "product-2",
        productNameSnapshot: "Product 2",
        variant: null,
        size: "L",
        counterpartyId: "counterparty-old",
        purchasePricePerUnit: 800,
        quantity: 1,
        items: [{ quantity: 1, sourceReturnId: null }],
        trackingNumber: "TRACK-2",
        shippingDate: new Date("2026-07-01"),
      },
    ]);
    mocks.counterpartyFindUnique.mockResolvedValue({
      id: "11111111-1111-4111-8111-111111111111",
    });
    mocks.transaction.mockImplementation(async (callback) =>
      callback({
        order: {
          findMany: mocks.findMany,
          update: mocks.orderUpdate,
        },
        orderItem: { updateMany: mocks.orderItemUpdateMany },
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
          action: "status",
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
          action: "status",
          orderIds: ["order-1", "missing"],
          status: "CANCELLED",
        }),
      }),
    );

    expect(response.status).toBe(404);
    expect(mocks.orderUpdate).not.toHaveBeenCalled();
    expect(mocks.createAuditLog).not.toHaveBeenCalled();
  });

  it("deduplicates repeated order IDs before updating", async () => {
    mocks.findMany.mockResolvedValueOnce([
      {
        id: "order-1",
        status: "ACCEPTED",
        items: [],
      },
    ]);

    const response = await POST(
      new NextRequest("http://localhost/api/orders/bulk-status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "status",
          orderIds: ["order-1", "order-1"],
          status: "RECEIVED",
        }),
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      success: true,
      updatedCount: 1,
    });
    expect(mocks.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: { in: ["order-1"] }, isDeleted: false },
      }),
    );
    expect(mocks.orderUpdate).toHaveBeenCalledTimes(1);
  });

  it("rejects an empty selection", async () => {
    const response = await POST(
      new NextRequest("http://localhost/api/orders/bulk-status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "status",
          orderIds: [],
          status: "RECEIVED",
        }),
      }),
    );

    expect(response.status).toBe(400);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("keeps purchase cost but clears sale price while items are returning", async () => {
    const response = await POST(
      new NextRequest("http://localhost/api/orders/bulk-status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "status",
          orderIds: ["order-1", "order-2"],
          status: "RETURNING",
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(mocks.orderUpdate).toHaveBeenCalledWith({
      where: { id: "order-1" },
      data: {
        status: "RETURNING",
        receivedAt: null,
        salePriceAtOrder: 0,
      },
    });
    expect(mocks.orderItemUpdateMany).toHaveBeenCalledWith({
      where: { orderId: "order-1" },
      data: { salePriceAtOrder: 0 },
    });
  });

  it("changes the counterparty for every selected order and audits each change", async () => {
    const counterpartyId = "11111111-1111-4111-8111-111111111111";
    const response = await POST(
      new NextRequest("http://localhost/api/orders/bulk-status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "counterparty",
          orderIds: ["order-1", "order-2"],
          counterpartyId,
        }),
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      success: true,
      updatedCount: 2,
    });
    expect(mocks.counterpartyFindUnique).toHaveBeenCalledWith({
      where: { id: counterpartyId },
      select: { id: true },
    });
    expect(mocks.orderUpdate).toHaveBeenCalledTimes(2);
    expect(mocks.orderUpdate).toHaveBeenCalledWith({
      where: { id: "order-1" },
      data: { counterpartyId },
    });
    expect(mocks.createAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        entityType: "ORDER",
        entityId: "order-1",
        fieldName: "counterpartyId",
        oldValue: "counterparty-old",
        newValue: counterpartyId,
      }),
      expect.anything(),
    );
    expect(mocks.orderItemUpdateMany).not.toHaveBeenCalled();
  });

  it("rejects an unknown counterparty before starting a transaction", async () => {
    mocks.counterpartyFindUnique.mockResolvedValueOnce(null);

    const response = await POST(
      new NextRequest("http://localhost/api/orders/bulk-status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "counterparty",
          orderIds: ["order-1"],
          counterpartyId: "11111111-1111-4111-8111-111111111111",
        }),
      }),
    );

    expect(response.status).toBe(404);
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.orderUpdate).not.toHaveBeenCalled();
  });

  it("sets purchase price per unit and keeps deposit-sourced items at zero", async () => {
    mocks.findMany.mockResolvedValueOnce([
      {
        id: "order-1",
        purchasePricePerUnit: 700,
        quantity: 3,
        items: [
          { quantity: 2, sourceReturnId: null },
          { quantity: 1, sourceReturnId: "return-1" },
        ],
      },
    ]);

    const response = await POST(
      new NextRequest("http://localhost/api/orders/bulk-status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "purchasePrice",
          orderIds: ["order-1"],
          purchasePricePerUnit: 450,
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(mocks.orderUpdate).toHaveBeenCalledWith({
      where: { id: "order-1" },
      data: { purchasePricePerUnit: 900 },
    });
    expect(mocks.orderItemUpdateMany).toHaveBeenCalledWith({
      where: { orderId: "order-1", sourceReturnId: null },
      data: { purchasePricePerUnit: 450 },
    });
    expect(mocks.createAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        fieldName: "purchasePricePerUnit",
        oldValue: "700",
        newValue: "900",
      }),
      expect.anything(),
    );
  });

  it("allows zero purchase price", async () => {
    const response = await POST(
      new NextRequest("http://localhost/api/orders/bulk-status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "purchasePrice",
          orderIds: ["order-1", "order-2"],
          purchasePricePerUnit: 0,
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(mocks.orderUpdate).toHaveBeenCalledWith({
      where: { id: "order-1" },
      data: { purchasePricePerUnit: 0 },
    });
  });

  it("does not restore purchase cost on cancelled orders", async () => {
    mocks.findMany.mockResolvedValueOnce([
      {
        id: "order-cancelled",
        status: "CANCELLED",
        purchasePricePerUnit: 0,
        quantity: 1,
        items: [{ quantity: 1, sourceReturnId: null }],
      },
    ]);

    const response = await POST(
      new NextRequest("http://localhost/api/orders/bulk-status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "purchasePrice",
          orderIds: ["order-cancelled"],
          purchasePricePerUnit: 500,
        }),
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      success: true,
      updatedCount: 0,
    });
    expect(mocks.orderUpdate).not.toHaveBeenCalled();
    expect(mocks.orderItemUpdateMany).not.toHaveBeenCalled();
    expect(mocks.createAuditLog).not.toHaveBeenCalled();
  });

  it("rejects a negative or ambiguous bulk update payload", async () => {
    const negativeResponse = await POST(
      new NextRequest("http://localhost/api/orders/bulk-status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "purchasePrice",
          orderIds: ["order-1"],
          purchasePricePerUnit: -1,
        }),
      }),
    );
    const missingActionResponse = await POST(
      new NextRequest("http://localhost/api/orders/bulk-status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orderIds: ["order-1"],
          counterpartyId: "11111111-1111-4111-8111-111111111111",
        }),
      }),
    );
    const mixedActionResponse = await POST(
      new NextRequest("http://localhost/api/orders/bulk-status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "status",
          orderIds: ["order-1"],
          status: "RECEIVED",
          purchasePricePerUnit: 500,
        }),
      }),
    );

    expect(negativeResponse.status).toBe(400);
    expect(missingActionResponse.status).toBe(400);
    expect(mixedActionResponse.status).toBe(400);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
});
