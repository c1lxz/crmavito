import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  prisma: {
    order: {
      findMany: vi.fn(),
      count: vi.fn(),
    },
    return: {
      findMany: vi.fn(),
      count: vi.fn(),
    },
  },
}));

vi.mock("@/lib/db/prisma", () => ({ prisma: mocks.prisma }));

import { getKpiForRange, getReturnsReport } from "@/lib/db/reports";

const range = {
  from: new Date("2026-06-30T21:00:00.000Z"),
  to: new Date("2026-07-31T20:59:59.999Z"),
};
const databaseDateRange = {
  from: new Date("2026-07-01T00:00:00.000Z"),
  to: new Date("2026-07-31T23:59:59.999Z"),
};

describe("report widget consistency", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.prisma.order.findMany.mockResolvedValue([]);
    mocks.prisma.order.count.mockResolvedValue(0);
    mocks.prisma.return.findMany.mockResolvedValue([]);
    mocks.prisma.return.count.mockResolvedValue(0);
  });

  it("counts completed standalone returns and valid order returns by return date", async () => {
    await getKpiForRange(range);

    expect(mocks.prisma.return.count).toHaveBeenCalledWith({
      where: {
        status: "RETURNED",
        returnDate: {
          gte: databaseDateRange.from,
          lte: databaseDateRange.to,
        },
        OR: [
          { orderId: null },
          {
            order: {
              isDeleted: false,
              status: { not: "CANCELLED" },
            },
          },
        ],
      },
    });
  });

  it("uses only completed returns and sold item quantities in the product return rate", async () => {
    mocks.prisma.return.findMany.mockResolvedValue([
      { productId: "product-1", product: { name: "Футболка" } },
      { productId: "product-1", product: { name: "Футболка" } },
    ]);
    mocks.prisma.order.findMany.mockResolvedValue([
      {
        productId: "legacy-product",
        quantity: 1,
        items: [
          { productId: "product-1", quantity: 3 },
          { productId: "product-2", quantity: 1 },
        ],
      },
      {
        productId: "product-1",
        quantity: 1,
        items: [],
      },
    ]);

    await expect(getReturnsReport(range)).resolves.toEqual([
      {
        productId: "product-1",
        name: "Футболка",
        returns: 2,
        returnPercent: 50,
      },
    ]);
    expect(mocks.prisma.return.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: "RETURNED",
          returnDate: {
            gte: databaseDateRange.from,
            lte: databaseDateRange.to,
          },
        }),
      }),
    );
  });

  it("does not assign standalone returns to a marketplace-specific report", async () => {
    await getKpiForRange(range, undefined, "WB");

    expect(mocks.prisma.return.count).toHaveBeenCalledWith({
      where: expect.objectContaining({
        status: "RETURNED",
        order: expect.objectContaining({
          marketplace: "WB",
          isDeleted: false,
          status: { not: "CANCELLED" },
        }),
      }),
    });
    const where = mocks.prisma.return.count.mock.calls[0][0].where;
    expect(where.OR).toBeUndefined();
  });
});
