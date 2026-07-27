import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  findWarehouseReturn,
  getArchivedReturnExclusion,
  getArchivedSourceOrderExclusion,
  getWarehouseBlockingOrderWhere,
  isExactWarehouseMatch,
} from "@/lib/orders/warehouse-match";
import { transferWarehouseCostsOnShipment } from "@/lib/orders/warehouse";

const returnedItem = {
  id: "return-1",
  productId: "product-1",
  variant: "Чёрный",
  size: "M",
};

describe("warehouse accounting for returned goods", () => {
  it("matches only one exact product, color and size", () => {
    expect(
      isExactWarehouseMatch(returnedItem, {
        productId: "product-1",
        variant: " чёрный ",
        size: "m",
        quantity: 1,
      }),
    ).toBe(true);
    expect(
      isExactWarehouseMatch(returnedItem, {
        productId: "product-1",
        variant: "Белый",
        size: "M",
        quantity: 1,
      }),
    ).toBe(false);
    expect(
      isExactWarehouseMatch(returnedItem, {
        productId: "product-1",
        variant: "Чёрный",
        size: "L",
        quantity: 1,
      }),
    ).toBe(false);
    expect(
      isExactWarehouseMatch(returnedItem, {
        productId: "product-1",
        variant: "Чёрный",
        size: "M",
        quantity: 2,
      }),
    ).toBe(false);
  });

  it("does not allocate the same returned unit twice in one order", () => {
    const matches = [returnedItem];
    expect(
      findWarehouseReturn(matches, {
        productId: "product-1",
        variant: "Чёрный",
        size: "M",
        quantity: 1,
      })?.id,
    ).toBe("return-1");
    expect(
      findWarehouseReturn(
        matches,
        {
          productId: "product-1",
          variant: "Чёрный",
          size: "M",
          quantity: 1,
        },
        new Set(["return-1"]),
      ),
    ).toBeUndefined();
  });

  it("keeps cancelled and deleted unshipped reservations from blocking stock", () => {
    expect(getWarehouseBlockingOrderWhere()).toEqual({
      OR: [
        { status: { in: ["SHIPPED", "RECEIVED", "RETURNING", "RETURNED", "CANCELLED"] } },
        { status: "ACCEPTED", isDeleted: false },
      ],
    });
  });

  it("archives a returned item as soon as it is selected for another order", () => {
    expect(getArchivedReturnExclusion()).toEqual({
      usedByOrderItems: {
        none: {},
      },
    });
    expect(getArchivedSourceOrderExclusion()).toEqual({
      returns: {
        none: {
          usedByOrderItems: {
            some: {},
          },
        },
      },
    });
  });

  it("moves cost to the new order on shipment and removes the recovered return loss", async () => {
    const orderItemFindMany = vi
      .fn()
      .mockResolvedValueOnce([
        {
          id: "new-item",
          sourceReturn: {
            productId: "product-1",
            variant: "Чёрный",
            size: "M",
            order: {
              id: "returned-order",
              purchasePricePerUnit: 700,
              items: [
                {
                  productId: "product-1",
                  variant: "Чёрный",
                  size: "M",
                  purchasePricePerUnit: 700,
                },
              ],
            },
          },
        },
      ])
      .mockResolvedValueOnce([
        { quantity: 1, purchasePricePerUnit: 700 },
      ]);
    const orderItemUpdate = vi.fn();
    const orderUpdate = vi.fn();
    const tx = {
      orderItem: {
        findMany: orderItemFindMany,
        update: orderItemUpdate,
      },
      order: { update: orderUpdate },
    };

    await expect(
      transferWarehouseCostsOnShipment(tx as never, "new-order"),
    ).resolves.toBe(1);

    expect(orderItemUpdate).toHaveBeenCalledWith({
      where: { id: "new-item" },
      data: { purchasePricePerUnit: 700 },
    });
    expect(orderUpdate).toHaveBeenCalledWith({
      where: { id: "returned-order" },
      data: {
        purchasePricePerUnit: 0,
        logisticsCost: 0,
        commissionCost: 0,
        otherCosts: 0,
      },
    });
    expect(orderUpdate).toHaveBeenCalledWith({
      where: { id: "new-order" },
      data: { purchasePricePerUnit: 700 },
    });
  });

  it("shows a simple warehouse badge without adding warehouse statuses", () => {
    const dialog = readFileSync(
      path.resolve(__dirname, "../components/orders/create-order-dialog.tsx"),
      "utf8",
    );
    const list = readFileSync(
      path.resolve(__dirname, "../components/orders/orders-client.tsx"),
      "utf8",
    );

    expect(dialog).toContain("Есть на складе");
    expect(dialog).toContain("будет использован автоматически");
    expect(dialog).not.toContain("Товар присутствует на депозите");
    expect(list).toContain("Есть на складе");
    expect(list).toContain("warehouseOnly && !hasWarehouseItem(o)");
    expect(list).toContain("aria-pressed={warehouseOnly}");
    expect(list).toContain('warehouse: warehouseOnly ? "1" : undefined');
  });
});
