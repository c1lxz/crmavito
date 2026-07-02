import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db/prisma";
import { createAuditLog } from "@/lib/db/audit";

const schema = z.object({
  status: z.enum(["ACCEPTED", "SHIPPED", "RECEIVED", "RETURNED", "CANCELLED"]),
  shippingDate: z.string().date().optional(),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const order = await prisma.order.findUnique({ where: { id, isDeleted: false } });
  if (!order) return NextResponse.json({ error: "Заказ не найден" }, { status: 404 });

  const { status, shippingDate } = parsed.data;
  if (status === order.status) return NextResponse.json({ success: true });

  await prisma.$transaction(async (tx) => {
    await tx.order.update({
      where: { id },
      data: {
        status,
        receivedAt: status === "RECEIVED" ? new Date() : null,
        ...(status === "SHIPPED" && shippingDate
          ? { shippingDate: new Date(shippingDate) }
          : {}),
      },
    });

    if (status === "RETURNED") {
      const existingReturn = await tx.return.findFirst({
        where: { orderId: id, status: { in: ["RETURNING", "RETURNED"] } },
      });
      if (existingReturn) {
        await tx.return.update({
          where: { id: existingReturn.id },
          data: { status: "RETURNED", returnDate: new Date() },
        });
      } else {
        await tx.return.create({
          data: {
            orderId: id,
            productId: order.productId,
            trackingNumber: order.trackingNumber,
            status: "RETURNED",
            shippingDate: order.shippingDate,
            returnDate: new Date(),
            reason: "Статус заказа изменён на «Возврат»",
          },
        });
      }
    } else if (order.status === "RETURNED" || order.status === "RETURNING") {
      await tx.return.updateMany({
        where: { orderId: id, status: { in: ["RETURNING", "RETURNED"] } },
        data: { status: "CANCELLED" },
      });
    }

    await createAuditLog(
      {
        entityType: "ORDER",
        entityId: id,
        userId: session.user.id,
        fieldName: "status",
        oldValue: order.status,
        newValue: status,
      },
      tx
    );
  });

  return NextResponse.json({ success: true });
}
