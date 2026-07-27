import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  orderFindMany: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    order: { findMany: mocks.orderFindMany },
  },
}));

import { createOrderSchema } from "@/lib/orders/schema";
import { getMarketplaceReport } from "@/lib/db/reports";

const orderInput = {
  counterpartyId: "11111111-1111-4111-8111-111111111111",
  trackingNumber: "TRACK-1",
  orderDate: "2026-07-27",
  items: [
    {
      productId: "22222222-2222-4222-8222-222222222222",
      quantity: 1,
      salePriceAtOrder: 2000,
      purchasePricePerUnit: 1000,
      imageUrls: [],
    },
  ],
};

function reportOrder(marketplace: "AVITO" | "WB", sale: number, purchase: number) {
  return {
    marketplace,
    orderDate: new Date("2026-07-27"),
    salePriceAtOrder: sale,
    purchasePricePerUnit: purchase,
    quantity: 1,
    logisticsCost: 100,
    commissionCost: 50,
    otherCosts: 0,
    product: {},
    counterparty: {},
    items: [],
  };
}

describe("marketplace orders and statistics", () => {
  beforeEach(() => vi.clearAllMocks());

  it("keeps existing order creation on Avito by default and accepts WB explicitly", () => {
    expect(createOrderSchema.parse(orderInput).marketplace).toBe("AVITO");
    expect(createOrderSchema.parse({ ...orderInput, marketplace: "WB" }).marketplace).toBe("WB");
  });

  it("separates order count, revenue and profit by marketplace", async () => {
    mocks.orderFindMany.mockResolvedValue([
      reportOrder("AVITO", 2000, 1000),
      reportOrder("WB", 3000, 1200),
    ]);

    const report = await getMarketplaceReport({
      from: new Date("2026-07-01"),
      to: new Date("2026-07-31"),
    });

    expect(report.summary).toEqual([
      expect.objectContaining({ marketplace: "AVITO", orders: 1, revenue: 2000, profit: 850 }),
      expect.objectContaining({ marketplace: "WB", orders: 1, revenue: 3000, profit: 1650 }),
    ]);
    expect(mocks.orderFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          isDeleted: false,
          status: { not: "CANCELLED" },
        }),
      }),
    );
  });

  it("exposes unobtrusive WB creation, filtering and comparison charts", () => {
    const orders = readFileSync(
      path.resolve(__dirname, "../components/orders/orders-client.tsx"),
      "utf8",
    );
    const reports = readFileSync(
      path.resolve(__dirname, "../components/reports/reports-client.tsx"),
      "utf8",
    );
    const charts = readFileSync(
      path.resolve(__dirname, "../components/dashboard/MarketplaceCharts.tsx"),
      "utf8",
    );

    expect(orders).toContain('setCreateMarketplace("WB")');
    expect(orders).toContain("Создать заказ Wildberries");
    expect(orders).toContain('value="WB">Wildberries');
    expect(reports).toContain("Заказы Авито / WB");
    expect(charts).toContain("Выручка и прибыль по площадкам");
    expect(charts).toContain("Динамика прибыли Авито / WB");
  });
});
