import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db/prisma";
import { createAuditLog } from "@/lib/db/audit";
import { detectCarrier } from "@/lib/tracking";
import { getLegacyOrderTotals, updateOrderSchema } from "@/lib/orders/schema";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: RouteContext) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const order = await prisma.order.findUnique({
    where: { id, isDeleted: false },
    include: {
      product: true,
      counterparty: true,
      items: { include: { product: true }, orderBy: { position: "asc" } },
      returns: true,
      auditLogs: {
        include: { user: true },
        orderBy: { timestamp: "desc" },
      },
    },
  });
  if (!order) return NextResponse.json({ error: "Заказ не найден" }, { status: 404 });
  return NextResponse.json(order);
}

export async function PATCH(req: NextRequest, { params }: RouteContext) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;

  const body = await req.json().catch(() => null);
  const parsed = updateOrderSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const order = await prisma.order.findUnique({
    where: { id, isDeleted: false },
    include: { items: true },
  });
  if (!order) return NextResponse.json({ error: "Заказ не найден" }, { status: 404 });

  const data = parsed.data;
  const productIds = data.items
    ? [...new Set(data.items.map((item) => item.productId))]
    : [];
  const products = productIds.length
    ? await prisma.product.findMany({ where: { id: { in: productIds } } })
    : [];
  if (data.items && products.length !== productIds.length) {
    return NextResponse.json({ error: "Один из товаров не найден" }, { status: 404 });
  }
  if (
    data.counterpartyId &&
    !(await prisma.counterparty.findUnique({ where: { id: data.counterpartyId } }))
  ) {
    return NextResponse.json({ error: "Контрагент не найден" }, { status: 404 });
  }

  const productsById = new Map(products.map((product) => [product.id, product]));
  const updateData: Record<string, unknown> = {};
  const auditEntries: Array<{ fieldName: string; oldValue: string; newValue: string }> = [];

  const setField = (fieldName: string, value: unknown, oldValue: unknown) => {
    if (value === undefined) return;
    const oldText = oldValue == null ? "" : String(oldValue);
    const newText = value == null ? "" : String(value);
    if (oldText === newText) return;
    updateData[fieldName] = value;
    auditEntries.push({ fieldName, oldValue: oldText, newValue: newText });
  };

  setField("counterpartyId", data.counterpartyId, order.counterpartyId);
  setField("purchaseComment", data.purchaseComment, order.purchaseComment);
  setField("trackingNumber", data.trackingNumber, order.trackingNumber);
  if (data.trackingNumber !== undefined || data.carrier !== undefined) {
    const trackingNumber = data.trackingNumber ?? order.trackingNumber;
    const carrier = data.carrier?.trim() || detectCarrier(trackingNumber)?.carrier || "";
    setField("carrier", carrier, order.carrier);
  }
  setField(
    "orderDate",
    data.orderDate ? new Date(data.orderDate) : undefined,
    order.orderDate
  );
  setField(
    "shippingDate",
    data.shippingDate === undefined
      ? undefined
      : data.shippingDate
        ? new Date(data.shippingDate)
        : null,
    order.shippingDate
  );
  setField("destinationCity", data.destinationCity, order.destinationCity);
  setField("logisticsCost", data.logisticsCost, order.logisticsCost);
  setField("commissionCost", data.commissionCost, order.commissionCost);
  setField("otherCosts", data.otherCosts, order.otherCosts);

  if (data.items) {
    const firstItem = data.items[0];
    const firstProduct = productsById.get(firstItem.productId)!;
    const totals = getLegacyOrderTotals(data.items);
    Object.assign(updateData, {
      productId: firstProduct.id,
      productNameSnapshot:
        data.items.length === 1
          ? firstProduct.name
          : `${firstProduct.name} + ещё ${data.items.length - 1}`,
      variant: firstItem.variant || null,
      size: firstItem.size || null,
      quantity: totals.quantity,
      salePriceAtOrder: totals.salePriceAtOrder,
      purchasePricePerUnit: totals.purchasePricePerUnit,
    });
    auditEntries.push({
      fieldName: "items",
      oldValue: `${order.items.length || 1}`,
      newValue: `${data.items.length}`,
    });
  }

  const updated = await prisma.$transaction(async (tx) => {
    if (data.items) {
      await tx.orderItem.deleteMany({ where: { orderId: id } });
      await tx.orderItem.createMany({
        data: data.items.map((item, position) => ({
          orderId: id,
          productId: item.productId,
          productNameSnapshot: productsById.get(item.productId)!.name,
          variant: item.variant || null,
          size: item.size || null,
          quantity: item.quantity,
          salePriceAtOrder: item.salePriceAtOrder,
          purchasePricePerUnit: item.purchasePricePerUnit,
          imageUrls: item.imageUrls,
          position,
        })),
      });
    }
    const result = await tx.order.update({ where: { id }, data: updateData });
    for (const entry of auditEntries) {
      await createAuditLog(
        {
          entityType: "ORDER",
          entityId: id,
          userId: session.user.id,
          ...entry,
        },
        tx
      );
    }
    return result;
  });

  return NextResponse.json(updated);
}

export async function DELETE(_req: NextRequest, { params }: RouteContext) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;

  const order = await prisma.order.findUnique({ where: { id, isDeleted: false } });
  if (!order) return NextResponse.json({ error: "Заказ не найден" }, { status: 404 });

  await prisma.$transaction(async (tx) => {
    await tx.order.update({ where: { id }, data: { isDeleted: true } });
    await createAuditLog(
      {
        entityType: "ORDER",
        entityId: id,
        userId: session.user.id,
        fieldName: "isDeleted",
        oldValue: "false",
        newValue: "true",
      },
      tx
    );
  });

  return NextResponse.json({ success: true });
}
