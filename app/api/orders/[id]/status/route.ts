import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db/prisma";
import { transitionOrderStatus, isTransitionAllowed } from "@/lib/db/orders";
import { createAuditLog } from "@/lib/db/audit";
import { z } from "zod";
import { OrderStatus } from "@prisma/client";

const schema = z.object({
  status: z.enum(["ACCEPTED", "SHIPPED", "RECEIVED", "RETURNING", "RETURNED"]),
  shippingDate: z.string().optional(),
  returnReason: z.string().optional(),
  returnComment: z.string().optional(),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;

  const body = await req.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const { status: toStatus, shippingDate, returnReason, returnComment } = parsed.data;

  const order = await prisma.order.findUnique({ where: { id, isDeleted: false } });
  if (!order) return NextResponse.json({ error: "Не найден" }, { status: 404 });

  if (!isTransitionAllowed(order.status, toStatus as OrderStatus)) {
    return NextResponse.json(
      { error: `Переход ${order.status} → ${toStatus} недопустим` },
      { status: 400 }
    );
  }

  if (toStatus === "RETURNING") {
    if (!returnReason) {
      return NextResponse.json({ error: "Укажите причину возврата" }, { status: 400 });
    }
    await prisma.$transaction(async (tx) => {
      await tx.order.update({ where: { id }, data: { status: "RETURNING" } });
      await tx.return.create({
        data: {
          orderId: id,
          productId: order.productId,
          trackingNumber: order.trackingNumber,
          status: "RETURNING",
          shippingDate: order.shippingDate,
          reason: returnReason,
          comment: returnComment,
        },
      });
      await createAuditLog({ entityType: "ORDER", entityId: id, userId: session.user.id, fieldName: "status", oldValue: order.status, newValue: "RETURNING" }, tx);
    });
    return NextResponse.json({ success: true });
  }

  await transitionOrderStatus(id, toStatus as OrderStatus, session.user.id, {
    shippingDate: shippingDate ? new Date(shippingDate) : undefined,
  });

  return NextResponse.json({ success: true });
}
