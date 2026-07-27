import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db/prisma";
import { createAuditLog } from "@/lib/db/audit";

const schema = z.object({
  orderIds: z.array(z.string().uuid()).min(1).max(500),
}).strict();

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
  const deletedCount = await prisma.$transaction(async (tx) => {
    const orders = await tx.order.findMany({
      where: { id: { in: orderIds }, isDeleted: false },
      select: { id: true },
    });
    if (orders.length !== orderIds.length) return null;

    await tx.order.updateMany({
      where: { id: { in: orderIds }, isDeleted: false },
      data: { isDeleted: true },
    });
    for (const order of orders) {
      await createAuditLog(
        {
          entityType: "ORDER",
          entityId: order.id,
          userId: session.user.id,
          fieldName: "isDeleted",
          oldValue: "false",
          newValue: "true",
        },
        tx,
      );
    }
    return orders.length;
  });

  if (deletedCount === null) {
    return NextResponse.json(
      { error: "Один из выбранных заказов уже удалён или не найден" },
      { status: 404 },
    );
  }

  return NextResponse.json({ success: true, deletedCount });
}
