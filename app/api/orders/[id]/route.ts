import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db/prisma";
import { createAuditLog } from "@/lib/db/audit";
import { z } from "zod";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const order = await prisma.order.findUnique({
    where: { id, isDeleted: false },
    include: { product: true, counterparty: true, returns: true, auditLogs: { include: { user: true }, orderBy: { timestamp: "desc" } } },
  });
  if (!order) return NextResponse.json({ error: "Не найден" }, { status: 404 });
  return NextResponse.json(order);
}

const updateSchema = z.object({
  variant: z.string().optional(),
  quantity: z.number().int().positive().optional(),
  salePriceAtOrder: z.number().positive().optional(),
  purchasePricePerUnit: z.number().nonnegative().optional(),
  purchaseComment: z.string().optional(),
  trackingNumber: z.string().optional(),
  carrier: z.string().trim().optional(),
  orderDate: z.string().optional(),
  shippingDate: z.string().nullable().optional(),
  destinationCity: z.string().optional(),
  logisticsCost: z.number().nonnegative().optional(),
  commissionCost: z.number().nonnegative().optional(),
  otherCosts: z.number().nonnegative().optional(),
});

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;

  const body = await req.json();
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const order = await prisma.order.findUnique({ where: { id, isDeleted: false } });
  if (!order) return NextResponse.json({ error: "Не найден" }, { status: 404 });

  const data = parsed.data;
  const updateData: Record<string, unknown> = {};
  const auditEntries: Array<{ field: string; old: string; new: string }> = [];

  for (const [key, val] of Object.entries(data)) {
    if (val !== undefined) {
      const oldVal = String((order as Record<string, unknown>)[key] ?? "");
      const newVal = key === "orderDate" || key === "shippingDate"
        ? val ? new Date(val as string).toISOString() : ""
        : String(val ?? "");
      if (oldVal !== newVal) {
        updateData[key] = key === "orderDate" ? new Date(val as string)
          : key === "shippingDate" ? (val ? new Date(val as string) : null)
          : val;
        auditEntries.push({ field: key, old: oldVal, new: newVal });
      }
    }
  }

  if (Object.keys(updateData).length === 0) return NextResponse.json(order);

  const updated = await prisma.$transaction(async (tx) => {
    const o = await tx.order.update({ where: { id }, data: updateData });
    for (const e of auditEntries) {
      await createAuditLog({ entityType: "ORDER", entityId: id, userId: session.user.id, fieldName: e.field, oldValue: e.old, newValue: e.new }, tx);
    }
    return o;
  });

  return NextResponse.json(updated);
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;

  const order = await prisma.order.findUnique({ where: { id, isDeleted: false } });
  if (!order) return NextResponse.json({ error: "Не найден" }, { status: 404 });
  if (order.status !== "ACCEPTED") {
    return NextResponse.json({ error: "Можно удалить только заказ в статусе «Принят»" }, { status: 400 });
  }

  await prisma.$transaction(async (tx) => {
    await tx.order.update({ where: { id }, data: { isDeleted: true } });
    await createAuditLog({ entityType: "ORDER", entityId: id, userId: session.user.id, fieldName: "isDeleted", oldValue: "false", newValue: "true" }, tx);
  });

  return NextResponse.json({ success: true });
}
