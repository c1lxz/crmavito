import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db/prisma";
import { createAuditLog } from "@/lib/db/audit";
import { z } from "zod";

const updateSchema = z.object({
  status: z.enum(["RETURNING", "RETURNED", "CANCELLED"]),
  returnDate: z.string().optional(),
});

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;

  const body = await req.json();
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const ret = await prisma.return.findUnique({ where: { id } });
  if (!ret) return NextResponse.json({ error: "Не найден" }, { status: 404 });

  const { status: newStatus, returnDate } = parsed.data;

  await prisma.$transaction(async (tx) => {
    await tx.return.update({
      where: { id },
      data: {
        status: newStatus,
        returnDate: newStatus === "RETURNED" && returnDate ? new Date(returnDate) : (newStatus === "RETURNED" ? new Date() : undefined),
      },
    });

    const orderStatus =
      newStatus === "RETURNED" ? "RETURNED"
      : newStatus === "CANCELLED" ? "RECEIVED"
      : "RETURNING";

    await tx.order.update({ where: { id: ret.orderId }, data: { status: orderStatus } });

    await createAuditLog({ entityType: "RETURN", entityId: id, userId: session.user.id, fieldName: "status", oldValue: ret.status, newValue: newStatus }, tx);
    await createAuditLog({ entityType: "ORDER", entityId: ret.orderId, userId: session.user.id, fieldName: "status", oldValue: "RETURNING", newValue: orderStatus }, tx);
  });

  return NextResponse.json({ success: true });
}
