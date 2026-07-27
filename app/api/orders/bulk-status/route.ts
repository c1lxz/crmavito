import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db/prisma";
import { createAuditLog } from "@/lib/db/audit";
import { getStatusFinancialUpdate } from "@/lib/orders/status";
import { transferWarehouseCostsOnShipment } from "@/lib/orders/warehouse";

const orderIdsSchema = z.array(z.string().min(1)).min(1).max(500);
const schema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("status"),
    orderIds: orderIdsSchema,
    status: z.enum([
      "ACCEPTED",
      "SHIPPED",
      "RECEIVED",
      "RETURNING",
      "RETURNED",
      "CANCELLED",
    ]),
  }).strict(),
  z.object({
    action: z.literal("counterparty"),
    orderIds: orderIdsSchema,
    counterpartyId: z.string().uuid(),
  }).strict(),
  z.object({
    action: z.literal("purchasePrice"),
    orderIds: orderIdsSchema,
    purchasePricePerUnit: z.number().finite().nonnegative().max(1_000_000_000),
  }).strict(),
]);

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const data = parsed.data;
  const orderIds = [...new Set(data.orderIds)];

  if (data.action === "counterparty") {
    const counterparty = await prisma.counterparty.findUnique({
      where: { id: data.counterpartyId },
      select: { id: true },
    });
    if (!counterparty) {
      return NextResponse.json({ error: "Контрагент не найден" }, { status: 404 });
    }
  }

  const updatedCount = await prisma.$transaction(async (tx) => {
    const orders = await tx.order.findMany({
      where: { id: { in: orderIds }, isDeleted: false },
      include: {
        items: {
          select: { quantity: true, sourceReturnId: true },
        },
      },
    });

    if (orders.length !== orderIds.length) return null;

    let changed = 0;
    for (const order of orders) {
      if (data.action === "counterparty") {
        if (order.counterpartyId === data.counterpartyId) continue;
        await tx.order.update({
          where: { id: order.id },
          data: { counterpartyId: data.counterpartyId },
        });
        await createAuditLog(
          {
            entityType: "ORDER",
            entityId: order.id,
            userId: session.user.id,
            fieldName: "counterpartyId",
            oldValue: order.counterpartyId,
            newValue: data.counterpartyId,
          },
          tx,
        );
        changed += 1;
        continue;
      }

      if (data.action === "purchasePrice") {
        if (order.status === "CANCELLED") continue;
        const eligibleQuantity =
          order.items.length > 0
            ? order.items.reduce(
                (sum, item) => sum + (item.sourceReturnId ? 0 : item.quantity),
                0,
              )
            : order.quantity;
        const legacyPurchaseTotal = data.purchasePricePerUnit * eligibleQuantity;
        await tx.order.update({
          where: { id: order.id },
          data: { purchasePricePerUnit: legacyPurchaseTotal },
        });
        await tx.orderItem.updateMany({
          where: { orderId: order.id, sourceReturnId: null },
          data: { purchasePricePerUnit: data.purchasePricePerUnit },
        });
        await createAuditLog(
          {
            entityType: "ORDER",
            entityId: order.id,
            userId: session.user.id,
            fieldName: "purchasePricePerUnit",
            oldValue: String(order.purchasePricePerUnit),
            newValue: String(legacyPurchaseTotal),
          },
          tx,
        );
        changed += 1;
        continue;
      }

      const status = data.status;
      if (order.status === status) continue;

      const financialUpdate = getStatusFinancialUpdate(status);
      await tx.order.update({
        where: { id: order.id },
        data: {
          status,
          receivedAt: status === "RECEIVED" ? new Date() : null,
          ...financialUpdate.order,
        },
      });
      if (financialUpdate.items) {
        await tx.orderItem.updateMany({
          where: { orderId: order.id },
          data: financialUpdate.items,
        });
      }
      if (status === "CANCELLED" && order.status === "ACCEPTED") {
        await tx.orderItem.updateMany({
          where: { orderId: order.id, sourceReturnId: { not: null } },
          data: { sourceReturnId: null },
        });
      }
      if (status === "SHIPPED") {
        await transferWarehouseCostsOnShipment(tx, order.id);
      }

      if (status === "RETURNING" || status === "RETURNED") {
        const existingReturn = await tx.return.findFirst({
          where: {
            orderId: order.id,
            status: { in: ["RETURNING", "RETURNED"] },
          },
        });
        if (existingReturn) {
          await tx.return.update({
            where: { id: existingReturn.id },
            data: {
              status,
              returnDate: status === "RETURNED" ? new Date() : null,
            },
          });
        } else {
          await tx.return.create({
            data: {
              orderId: order.id,
              productId: order.productId,
              productNameSnapshot: order.productNameSnapshot,
              variant: order.variant,
              size: order.size,
              trackingNumber: order.trackingNumber,
              status,
              shippingDate: order.shippingDate,
              returnDate: status === "RETURNED" ? new Date() : null,
              reason:
                status === "RETURNED"
                  ? "Статус заказа массово изменён на «Возвращён»"
                  : "Статус заказа массово изменён на «На возврате»",
            },
          });
        }
      } else if (order.status === "RETURNED" || order.status === "RETURNING") {
        await tx.return.updateMany({
          where: {
            orderId: order.id,
            status: { in: ["RETURNING", "RETURNED"] },
          },
          data: { status: "CANCELLED" },
        });
      }

      await createAuditLog(
        {
          entityType: "ORDER",
          entityId: order.id,
          userId: session.user.id,
          fieldName: "status",
          oldValue: order.status,
          newValue: status,
        },
        tx,
      );
      changed += 1;
    }

    return changed;
  });

  if (updatedCount === null) {
    return NextResponse.json(
      { error: "Некоторые выбранные заказы не найдены. Обновите страницу." },
      { status: 404 },
    );
  }

  return NextResponse.json({ success: true, updatedCount });
}
