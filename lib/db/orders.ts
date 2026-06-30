import { prisma } from "./prisma";
import { OrderStatus } from "@prisma/client";
import { calcOrderFinancials } from "@/lib/finance/calculations";
import { createAuditLog } from "./audit";

const ALLOWED_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  ACCEPTED: ["SHIPPED"],
  SHIPPED: ["RECEIVED", "RETURNING"],
  RECEIVED: ["RETURNING"],
  RETURNING: ["RETURNED"],
  RETURNED: [],
};

export function getAllowedNextStatuses(current: OrderStatus): OrderStatus[] {
  return ALLOWED_TRANSITIONS[current] ?? [];
}

export function isTransitionAllowed(from: OrderStatus, to: OrderStatus): boolean {
  return ALLOWED_TRANSITIONS[from]?.includes(to) ?? false;
}

export function toDecimalNumber(val: unknown): number {
  if (typeof val === "number") return val;
  if (typeof val === "string") return parseFloat(val);
  if (val && typeof (val as { toNumber: () => number }).toNumber === "function") {
    return (val as { toNumber: () => number }).toNumber();
  }
  return 0;
}

export function enrichOrderWithFinancials<
  T extends {
    salePriceAtOrder: unknown;
    quantity: number;
    purchasePricePerUnit: unknown;
    logisticsCost: unknown;
    commissionCost: unknown;
    otherCosts: unknown;
  },
>(order: T) {
  const fin = calcOrderFinancials({
    salePriceAtOrder: toDecimalNumber(order.salePriceAtOrder),
    quantity: order.quantity,
    purchasePricePerUnit: toDecimalNumber(order.purchasePricePerUnit),
    logisticsCost: toDecimalNumber(order.logisticsCost),
    commissionCost: toDecimalNumber(order.commissionCost),
    otherCosts: toDecimalNumber(order.otherCosts),
  });
  return { ...order, ...fin };
}

export async function generateOrderNumber(): Promise<string> {
  const last = await prisma.order.findFirst({
    orderBy: { createdAt: "desc" },
    select: { orderNumber: true },
  });
  const num = last ? parseInt(last.orderNumber.replace(/\D/g, ""), 10) + 1 : 1;
  return String(num).padStart(4, "0");
}

export async function transitionOrderStatus(
  orderId: string,
  toStatus: OrderStatus,
  userId: string,
  extra?: { shippingDate?: Date; receivedAt?: Date }
) {
  return prisma.$transaction(async (tx) => {
    const order = await tx.order.findUniqueOrThrow({ where: { id: orderId } });

    if (!isTransitionAllowed(order.status, toStatus)) {
      throw new Error(
        `Переход статуса ${order.status} → ${toStatus} недопустим`
      );
    }

    const updateData: Record<string, unknown> = { status: toStatus };
    if (toStatus === "SHIPPED" && extra?.shippingDate) {
      updateData.shippingDate = extra.shippingDate;
    }
    if (toStatus === "RECEIVED") {
      updateData.receivedAt = extra?.receivedAt ?? new Date();
    }

    const updated = await tx.order.update({
      where: { id: orderId },
      data: updateData,
    });

    await createAuditLog(
      {
        entityType: "ORDER",
        entityId: orderId,
        userId,
        fieldName: "status",
        oldValue: order.status,
        newValue: toStatus,
      },
      tx
    );

    // Keep Return records in sync: when an order moves into RETURNED, any
    // still-open RETURNING return for it must close out too — otherwise it
    // sticks on the Возвраты screen with "Товар получен" / "Отменить" buttons
    // that look broken from the user's point of view.
    if (toStatus === "RETURNED") {
      const openReturns = await tx.return.findMany({
        where: { orderId, status: "RETURNING" },
        select: { id: true },
      });
      if (openReturns.length > 0) {
        await tx.return.updateMany({
          where: { orderId, status: "RETURNING" },
          data: { status: "RETURNED", returnDate: extra?.receivedAt ?? new Date() },
        });
        for (const r of openReturns) {
          await createAuditLog(
            {
              entityType: "RETURN",
              entityId: r.id,
              userId,
              fieldName: "status",
              oldValue: "RETURNING",
              newValue: "RETURNED",
            },
            tx
          );
        }
      }
    }

    return updated;
  });
}
