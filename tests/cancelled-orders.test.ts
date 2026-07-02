import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { readFileSync } from "node:fs";
import path from "node:path";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  findUnique: vi.fn(),
  transaction: vi.fn(),
  orderUpdate: vi.fn(),
  returnFindFirst: vi.fn(),
  returnUpdateMany: vi.fn(),
  createAuditLog: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    order: { findUnique: mocks.findUnique },
    $transaction: mocks.transaction,
  },
}));
vi.mock("@/lib/db/audit", () => ({ createAuditLog: mocks.createAuditLog }));

import { POST } from "@/app/api/orders/[id]/status/route";

describe("cancelled orders", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.mockResolvedValue({ user: { id: "user-1" } });
    mocks.findUnique.mockResolvedValue({
      id: "order-1",
      status: "RECEIVED",
      productId: "product-1",
      trackingNumber: "TRACK",
      shippingDate: null,
    });
    mocks.transaction.mockImplementation(async (callback) =>
      callback({
        order: { update: mocks.orderUpdate },
        return: {
          findFirst: mocks.returnFindFirst,
          updateMany: mocks.returnUpdateMany,
        },
      }),
    );
  });

  it("keeps the order but clears sale time when status becomes cancelled", async () => {
    const response = await POST(
      new NextRequest("http://localhost/api/orders/order-1/status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "CANCELLED" }),
      }),
      { params: Promise.resolve({ id: "order-1" }) },
    );

    expect(response.status).toBe(200);
    expect(mocks.orderUpdate).toHaveBeenCalledWith({
      where: { id: "order-1" },
      data: {
        status: "CANCELLED",
        receivedAt: null,
      },
    });
    expect(mocks.createAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        oldValue: "RECEIVED",
        newValue: "CANCELLED",
      }),
      expect.anything(),
    );
  });

  it("excludes cancelled orders from every financial dashboard source", () => {
    const dashboard = readFileSync(
      path.resolve(__dirname, "../app/(app)/dashboard/page.tsx"),
      "utf8",
    );
    const reports = readFileSync(
      path.resolve(__dirname, "../lib/db/reports.ts"),
      "utf8",
    );
    const counterparties = readFileSync(
      path.resolve(__dirname, "../app/(app)/counterparties/page.tsx"),
      "utf8",
    );

    expect(dashboard.match(/status: \{ not: "CANCELLED" \}/g)?.length).toBeGreaterThanOrEqual(3);
    expect(reports.match(/status: \{ not: "CANCELLED" \}/g)?.length).toBeGreaterThanOrEqual(6);
    expect(counterparties).toContain('status: { not: "CANCELLED" }');
  });
});
