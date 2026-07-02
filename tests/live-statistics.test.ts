import { beforeEach, describe, expect, it, vi } from "vitest";
import { summarizeExpensesForMonth } from "@/lib/expenses/summary";

const mocks = vi.hoisted(() => ({
  prisma: {
    order: {
      findMany: vi.fn(),
      count: vi.fn(),
      groupBy: vi.fn(),
    },
    return: {
      count: vi.fn(),
    },
    expense: {
      findMany: vi.fn(),
    },
  },
}));

vi.mock("@/lib/db/prisma", () => ({ prisma: mocks.prisma }));

import {
  getExpenseCategoryTotals,
  getKpiForRange,
  getOrderStatusCounts,
} from "@/lib/db/reports";

const range = {
  from: new Date("2026-06-30T21:00:00.000Z"),
  to: new Date("2026-07-31T20:59:59.999Z"),
};
const databaseDateRange = {
  from: new Date("2026-07-01T00:00:00.000Z"),
  to: new Date("2026-07-31T23:59:59.999Z"),
};

describe("live statistics calculations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.prisma.return.count.mockResolvedValue(0);
    mocks.prisma.order.count.mockResolvedValue(0);
  });

  it("counts accepted active orders in KPI and excludes deleted orders at query level", async () => {
    mocks.prisma.order.findMany.mockResolvedValue([
      {
        status: "ACCEPTED",
        salePriceAtOrder: 2500,
        quantity: 1,
        purchasePricePerUnit: 1000,
        logisticsCost: 100,
        commissionCost: 0,
        otherCosts: 0,
        items: [],
        product: {},
        counterparty: {},
      },
    ]);

    const result = await getKpiForRange(range);

    expect(mocks.prisma.order.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          isDeleted: false,
          status: { not: "CANCELLED" },
          orderDate: { gte: databaseDateRange.from, lte: databaseDateRange.to },
        }),
      })
    );
    expect(result).toMatchObject({
      ordersCount: 1,
      revenue: 2500,
      avgCheck: 2500,
      netProfit: 1400,
    });
    expect(result.marginPercent).toBe(60);
  });

  it("filters deleted and cancelled orders from status statistics", async () => {
    mocks.prisma.order.groupBy.mockResolvedValue([
      { status: "ACCEPTED", _count: { _all: 7 } },
    ]);

    await expect(getOrderStatusCounts(range)).resolves.toEqual({ ACCEPTED: 7 });
    expect(mocks.prisma.order.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          isDeleted: false,
          status: { not: "CANCELLED" },
          orderDate: { gte: databaseDateRange.from, lte: databaseDateRange.to },
        },
      })
    );
  });

  it("returns exact expense totals without adding order costs", async () => {
    mocks.prisma.expense.findMany.mockResolvedValue([
      { category: "OTHER", amount: 2500 },
    ]);

    await expect(getExpenseCategoryTotals(range)).resolves.toEqual({ OTHER: 2500 });
  });
});

describe("expense cards", () => {
  it("recalculates current-month total and category cards from the visible expense list", () => {
    expect(
      summarizeExpensesForMonth(
        [
          { date: "2026-07-01T00:00:00.000Z", category: "OTHER", amount: 2500 },
          { date: "2026-06-30T00:00:00.000Z", category: "OTHER", amount: 500 },
        ],
        new Date(2026, 6, 1)
      )
    ).toEqual({ total: 2500, byCategory: { OTHER: 2500 } });
  });

  it("assigns expenses around midnight to the Moscow calendar month", () => {
    expect(
      summarizeExpensesForMonth(
        [
          { date: "2026-06-30T20:59:59.999Z", category: "OTHER", amount: 500 },
          { date: "2026-06-30T21:00:00.000Z", category: "OTHER", amount: 2500 },
        ],
        new Date("2026-06-30T22:00:00.000Z"),
      ),
    ).toEqual({ total: 2500, byCategory: { OTHER: 2500 } });
  });
});
