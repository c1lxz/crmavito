import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db/prisma";
import { createAuditLog } from "@/lib/db/audit";
import { getStatusFinancialUpdate } from "@/lib/orders/status";

const schema = z.object({
  orderIds: z.array(z.string().min(1)).min(1).max(500),
  status: z.enum(["ACCEPTED", "SHIPPED", "RECEIVED", "RETURNING", "RETURNED", "CANCELLED"]),
});

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const orderIds = [...new Set(parsed.data.orderIds)];
  const { status } = parsed.data;

  const updatedCount = await prisma.$transaction(async (tx) => {
    const orders = await tx.order.findMany({
      where: { id: { in: orderIds }, isDeleted: false },
    });

    if (orders.length !== orderIds.length) return null;

    let changed = 0;
    for (const order of orders) {
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
