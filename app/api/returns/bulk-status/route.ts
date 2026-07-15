import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db/prisma";
import { createAuditLog } from "@/lib/db/audit";
import { z } from "zod";

const bulkUpdateSchema = z.object({
  returnIds: z.array(z.string().uuid()).min(1).max(200),
  status: z.enum(["RETURNING", "RETURNED", "CANCELLED"]),
  returnDate: z.string().date().optional(),
});

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = bulkUpdateSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { returnIds, status: newStatus, returnDate } = parsed.data;
  const uniqueIds = [...new Set(returnIds)];
  const returns = await prisma.return.findMany({
    where: { id: { in: uniqueIds } },
    include: { order: { select: { status: true, receivedAt: true } } },
  });

  if (returns.length !== uniqueIds.length) {
    return NextResponse.json({ error: "Один из возвратов не найден" }, { status: 404 });
  }

  let updatedCount = 0;
  await prisma.$transaction(async (tx) => {
    for (const ret of returns) {
      if (ret.status === newStatus) continue;

      const nextReturnDate =
        newStatus === "RETURNED"
          ? returnDate
            ? new Date(`${returnDate}T12:00:00+03:00`)
            : new Date()
          : null;

      await tx.return.update({
        where: { id: ret.id },
        data: { status: newStatus, returnDate: nextReturnDate },
      });
      updatedCount += 1;

      if (!ret.orderId || !ret.order) continue;

      const orderStatus =
        newStatus === "RETURNED"
          ? "RETURNED"
          : newStatus === "CANCELLED" && ret.order.receivedAt
            ? "RECEIVED"
            : newStatus === "CANCELLED"
              ? "SHIPPED"
              : "RETURNING";

      if (ret.order.status !== orderStatus) {
        await tx.order.update({ where: { id: ret.orderId }, data: { status: orderStatus } });
      }

      await createAuditLog(
        {
          entityType: "RETURN",
          entityId: ret.orderId,
          userId: session.user.id,
          fieldName: "status",
          oldValue: ret.status,
          newValue: newStatus,
        },
        tx,
      );
      await createAuditLog(
        {
          entityType: "ORDER",
          entityId: ret.orderId,
          userId: session.user.id,
          fieldName: "status",
          oldValue: ret.order.status,
          newValue: orderStatus,
        },
        tx,
      );
    }
  });

  return NextResponse.json({ success: true, updatedCount });
}
