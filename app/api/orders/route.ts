import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db/prisma";
import { generateOrderNumber } from "@/lib/db/orders";
import { createAuditLog } from "@/lib/db/audit";
import { detectCarrier } from "@/lib/tracking";
import { sendOrderToGroup } from "@/lib/telegram/notify";
import { resolveProductImage } from "@/lib/avito/fetch-image";
import { z } from "zod";

const createOrderSchema = z.object({
  productId: z.string().uuid(),
  variant: z.string().optional(),
  size: z.string().optional(),
  quantity: z.number().int().positive(),
  salePriceAtOrder: z.number().positive(),
  counterpartyId: z.string().uuid(),
  purchasePricePerUnit: z.number().nonnegative(),
  purchaseComment: z.string().optional(),
  trackingNumber: z.string().min(1),
  carrier: z.string().trim().optional(),
  productImageUrl: z.string().trim().url().optional(),
  orderDate: z.string(),
  shippingDate: z.string().optional(),
  logisticsCost: z.number().nonnegative().default(0),
  commissionCost: z.number().nonnegative().default(0),
  otherCosts: z.number().nonnegative().default(0),
});

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status");
  const tracking = searchParams.get("tracking");
  const counterpartyId = searchParams.get("counterpartyId");
  const productId = searchParams.get("productId");
  const dateFrom = searchParams.get("dateFrom");
  const dateTo = searchParams.get("dateTo");
  const page = parseInt(searchParams.get("page") ?? "1");
  const pageSize = parseInt(searchParams.get("pageSize") ?? "20");

  const where: Record<string, unknown> = { isDeleted: false };
  if (status) where.status = status;
  if (tracking) where.trackingNumber = { contains: tracking, mode: "insensitive" };
  if (counterpartyId) where.counterpartyId = counterpartyId;
  if (productId) where.productId = productId;
  if (dateFrom || dateTo) {
    where.orderDate = {};
    if (dateFrom) (where.orderDate as Record<string, Date>).gte = new Date(dateFrom);
    if (dateTo) (where.orderDate as Record<string, Date>).lte = new Date(dateTo);
  }

  const [orders, total] = await Promise.all([
    prisma.order.findMany({
      where,
      include: { product: true, counterparty: true },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.order.count({ where }),
  ]);

  return NextResponse.json({ orders, total, page, pageSize });
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const parsed = createOrderSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const data = parsed.data;
  const product = await prisma.product.findUnique({ where: { id: data.productId } });
  if (!product) return NextResponse.json({ error: "Товар не найден" }, { status: 404 });

  const counterparty = await prisma.counterparty.findUnique({ where: { id: data.counterpartyId } });
  if (!counterparty) return NextResponse.json({ error: "Контрагент не найден" }, { status: 404 });

  const orderNumber = await generateOrderNumber();
  const carrier = data.carrier?.trim() || detectCarrier(data.trackingNumber);

  const order = await prisma.$transaction(async (tx) => {
    const o = await tx.order.create({
      data: {
        orderNumber,
        productId: data.productId,
        productNameSnapshot: product.name,
        variant: data.variant,
        size: data.size,
        quantity: data.quantity,
        salePriceAtOrder: data.salePriceAtOrder,
        counterpartyId: data.counterpartyId,
        purchasePricePerUnit: data.purchasePricePerUnit,
        purchaseComment: data.purchaseComment,
        trackingNumber: data.trackingNumber,
        carrier,
        orderDate: new Date(data.orderDate),
        shippingDate: data.shippingDate ? new Date(data.shippingDate) : null,
        logisticsCost: data.logisticsCost,
        commissionCost: data.commissionCost,
        otherCosts: data.otherCosts,
        createdByUserId: session.user.id,
      },
    });
    await createAuditLog(
      { entityType: "ORDER", entityId: o.id, userId: session.user.id, fieldName: "status", oldValue: null, newValue: "ACCEPTED" },
      tx
    );
    return o;
  });

  let imageUrl: string | null = data.productImageUrl ?? product.imageUrl;
  if (data.productImageUrl && data.productImageUrl !== product.imageUrl) {
    await prisma.product
      .update({ where: { id: product.id }, data: { imageUrl: data.productImageUrl } })
      .catch(() => null);
  }
  if (!imageUrl && (product.avitoItemId || product.avitoListingUrl)) {
    const r = await resolveProductImage({
      avitoItemId: product.avitoItemId,
      avitoListingUrl: product.avitoListingUrl,
    });
    if (r.ok) {
      imageUrl = r.value;
      await prisma.product
        .update({ where: { id: product.id }, data: { imageUrl } })
        .catch(() => null);
    } else {
      console.warn(`[avito] order ${order.orderNumber}: ${r.reason}`);
    }
  }

  await sendOrderToGroup({
    orderNumber: order.orderNumber,
    productName: product.name,
    variant: data.variant ?? null,
    size: data.size ?? null,
    quantity: data.quantity,
    salePrice: data.salePriceAtOrder,
    trackingNumber: data.trackingNumber,
    carrier,
    counterpartyName: counterparty.name,
    productImageUrl: imageUrl,
    orderDate: new Date(data.orderDate),
  }).catch((e) => console.error("[telegram] notify failed", e));

  return NextResponse.json(order, { status: 201 });
}
