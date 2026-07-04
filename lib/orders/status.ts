import type { OrderStatus } from "@prisma/client";

export function getStatusFinancialUpdate(status: OrderStatus) {
  if (status === "CANCELLED") {
    return {
      order: { salePriceAtOrder: 0, purchasePricePerUnit: 0 },
      items: { salePriceAtOrder: 0, purchasePricePerUnit: 0 },
    };
  }

  if (status === "RETURNING" || status === "RETURNED") {
    return {
      order: { salePriceAtOrder: 0 },
      items: { salePriceAtOrder: 0 },
    };
  }

  return { order: {}, items: null };
}
