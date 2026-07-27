export interface WarehouseReturnMatch {
  id: string;
  productId: string;
  size: string | null;
  variant: string | null;
}

export interface WarehouseOrderItemMatch {
  productId: string;
  size?: string | null;
  variant?: string | null;
  quantity: number;
}

export function normalizeWarehouseValue(value: string | null | undefined) {
  return (value ?? "").trim().toLocaleLowerCase("ru-RU");
}

export function isExactWarehouseMatch(
  returnedItem: WarehouseReturnMatch,
  orderItem: WarehouseOrderItemMatch,
) {
  return (
    orderItem.quantity === 1 &&
    returnedItem.productId === orderItem.productId &&
    normalizeWarehouseValue(returnedItem.size) === normalizeWarehouseValue(orderItem.size) &&
    normalizeWarehouseValue(returnedItem.variant) === normalizeWarehouseValue(orderItem.variant)
  );
}

export function findWarehouseReturn<T extends WarehouseReturnMatch>(
  returnedItems: T[],
  orderItem: WarehouseOrderItemMatch,
  excludedIds: ReadonlySet<string> = new Set(),
) {
  return returnedItems.find(
    (returnedItem) =>
      !excludedIds.has(returnedItem.id) &&
      isExactWarehouseMatch(returnedItem, orderItem),
  );
}

export function getWarehouseBlockingOrderWhere(): Prisma.OrderWhereInput {
  return {
    OR: [
      { status: { in: ["SHIPPED", "RECEIVED", "RETURNING", "RETURNED"] } },
      { status: "ACCEPTED", isDeleted: false },
    ],
  };
}
import type { Prisma } from "@prisma/client";
