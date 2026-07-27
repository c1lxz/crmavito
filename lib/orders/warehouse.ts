import type { Prisma } from "@prisma/client";
import { toDecimalNumber } from "@/lib/db/orders";
import { normalizeWarehouseValue } from "@/lib/orders/warehouse-match";

function matchesReturnedUnit(
  item: { productId: string; size: string | null; variant: string | null },
  returnedItem: { productId: string; size: string | null; variant: string | null },
) {
  return (
    item.productId === returnedItem.productId &&
    normalizeWarehouseValue(item.size) === normalizeWarehouseValue(returnedItem.size) &&
    normalizeWarehouseValue(item.variant) === normalizeWarehouseValue(returnedItem.variant)
  );
}

export async function transferWarehouseCostsOnShipment(
  tx: Prisma.TransactionClient,
  orderId: string,
) {
  const warehouseItems = await tx.orderItem.findMany({
    where: {
      orderId,
      sourceReturnId: { not: null },
      purchasePricePerUnit: 0,
    },
    include: {
      sourceReturn: {
        include: {
          order: {
            include: {
              items: {
                select: {
                  productId: true,
                  size: true,
                  variant: true,
                  purchasePricePerUnit: true,
                },
              },
            },
          },
        },
      },
    },
  });

  const sourceOrderRemainingCosts = new Map<string, number>();
  let transferred = 0;

  for (const warehouseItem of warehouseItems) {
    const returnedItem = warehouseItem.sourceReturn;
    const sourceOrder = returnedItem?.order;
    if (!returnedItem || !sourceOrder) continue;

    const sourceItem = sourceOrder.items.find((item) =>
      matchesReturnedUnit(item, returnedItem),
    );
    const sourceCost = sourceItem
      ? toDecimalNumber(sourceItem.purchasePricePerUnit)
      : 0;
    if (sourceCost <= 0) continue;

    await tx.orderItem.update({
      where: { id: warehouseItem.id },
      data: { purchasePricePerUnit: sourceCost },
    });

    const currentRemaining =
      sourceOrderRemainingCosts.get(sourceOrder.id) ??
      toDecimalNumber(sourceOrder.purchasePricePerUnit);
    const nextRemaining = Math.max(0, currentRemaining - sourceCost);
    sourceOrderRemainingCosts.set(sourceOrder.id, nextRemaining);
    transferred += 1;
  }

  for (const [sourceOrderId, remainingCost] of sourceOrderRemainingCosts) {
    await tx.order.update({
      where: { id: sourceOrderId },
      data: {
        purchasePricePerUnit: remainingCost,
        ...(remainingCost === 0
          ? {
              logisticsCost: 0,
              commissionCost: 0,
              otherCosts: 0,
            }
          : {}),
      },
    });
  }

  if (transferred > 0) {
    const currentItems = await tx.orderItem.findMany({
      where: { orderId },
      select: { quantity: true, purchasePricePerUnit: true },
    });
    const purchaseTotal = currentItems.reduce(
      (sum, item) =>
        sum + toDecimalNumber(item.purchasePricePerUnit) * item.quantity,
      0,
    );
    await tx.order.update({
      where: { id: orderId },
      data: { purchasePricePerUnit: purchaseTotal },
    });
  }

  return transferred;
}
