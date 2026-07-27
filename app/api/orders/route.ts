import { NextRequest, NextResponse } from "next/server";
import { Prisma, type Order } from "@prisma/client";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db/prisma";
import { generateOrderNumber } from "@/lib/db/orders";
import { createAuditLog } from "@/lib/db/audit";
import { detectCarrier } from "@/lib/tracking";
import { processOrderNotificationByOrderId } from "@/lib/telegram/order-notification-queue";
import { createOrderSchema, getLegacyOrderTotals } from "@/lib/orders/schema";
import { parseDatabaseDateInput } from "@/lib/utils";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const statusParam = searchParams.get("status");
  const tracking = searchParams.get("tracking");
  const counterpartyId = searchParams.get("counterpartyId");
  const avitoProfileId = searchParams.get("avitoProfileId");
  const marketplace = searchParams.get("marketplace");
  const productId = searchParams.get("productId");
  const dateFrom = searchParams.get("dateFrom");
  const dateTo = searchParams.get("dateTo");
  const parsedPage = Number(searchParams.get("page") ?? "1");
  const parsedPageSize = Number(searchParams.get("pageSize") ?? "20");
  const page = Number.isInteger(parsedPage) && parsedPage > 0 ? parsedPage : 1;
  const pageSize =
    Number.isInteger(parsedPageSize) && parsedPageSize > 0
      ? Math.min(parsedPageSize, 100)
      : 20;

  const where: Prisma.OrderWhereInput = { isDeleted: false };
  if (statusParam) {
    const status = z
      .enum(["ACCEPTED", "SHIPPED", "RECEIVED", "RETURNING", "RETURNED", "CANCELLED"])
      .safeParse(statusParam);
    if (!status.success) {
      return NextResponse.json({ error: "Некорректный статус" }, { status: 400 });
    }
    where.status = status.data;
  }
  if (tracking) where.trackingNumber = { contains: tracking, mode: "insensitive" };
  if (counterpartyId) where.counterpartyId = counterpartyId;
  if (avitoProfileId) where.avitoProfileId = avitoProfileId;
  if (marketplace) {
    const parsedMarketplace = z.enum(["AVITO", "WB"]).safeParse(marketplace);
    if (!parsedMarketplace.success) {
      return NextResponse.json({ error: "Некорректная площадка" }, { status: 400 });
    }
    where.marketplace = parsedMarketplace.data;
  }
  if (productId) {
    where.OR = [{ productId }, { items: { some: { productId } } }];
  }
  if (dateFrom || dateTo) {
    if (dateFrom && !z.string().date().safeParse(dateFrom).success) {
      return NextResponse.json({ error: "Некорректная начальная дата" }, { status: 400 });
    }
    if (dateTo && !z.string().date().safeParse(dateTo).success) {
      return NextResponse.json({ error: "Некорректная конечная дата" }, { status: 400 });
    }
    where.orderDate = {};
    if (dateFrom) where.orderDate.gte = parseDatabaseDateInput(dateFrom);
    if (dateTo) where.orderDate.lte = parseDatabaseDateInput(dateTo, true);
  }

  const [orders, total] = await Promise.all([
    prisma.order.findMany({
      where,
      include: {
        product: true,
        counterparty: true,
        items: { include: { product: true }, orderBy: { position: "asc" } },
      },
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

  const body = await req.json().catch(() => null);
  const parsed = createOrderSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const data = parsed.data;
  const trackingConflict = await prisma.order.findFirst({
    where: {
      isDeleted: false,
      trackingNumber: { equals: data.trackingNumber, mode: "insensitive" },
    },
    select: { orderNumber: true },
  });
  if (trackingConflict) {
    return NextResponse.json(
      { error: `Заказ с трек-номером ${data.trackingNumber} уже существует: ${trackingConflict.orderNumber}` },
      { status: 409 },
    );
  }

  const productIds = [...new Set(data.items.map((item) => item.productId))];
  const sourceReturnIds = data.items.flatMap((item) =>
    item.sourceReturnId ? [item.sourceReturnId] : [],
  );
  const [products, sourceReturns] = await Promise.all([
    prisma.product.findMany({ where: { id: { in: productIds } } }),
    sourceReturnIds.length
      ? prisma.return.findMany({
          where: {
            id: { in: sourceReturnIds },
            status: "RETURNED",
            usedByOrderItems: { none: {} },
          },
        })
      : Promise.resolve([]),
  ]);
  if (products.length !== productIds.length) {
    return NextResponse.json({ error: "Один из товаров не найден" }, { status: 404 });
  }
  if (sourceReturns.length !== sourceReturnIds.length) {
    return NextResponse.json(
      { error: "Один из товаров с депозита уже использован или недоступен" },
      { status: 409 },
    );
  }
  const sourceReturnsById = new Map(sourceReturns.map((ret) => [ret.id, ret]));
  const sourceMismatch = data.items.some((item) => {
    if (!item.sourceReturnId) return false;
    const ret = sourceReturnsById.get(item.sourceReturnId);
    return (
      !ret ||
      ret.productId !== item.productId ||
      (ret.size ?? "").trim().toLowerCase() !== (item.size ?? "").trim().toLowerCase()
    );
  });
  if (sourceMismatch) {
    return NextResponse.json(
      { error: "Товар с депозита не совпадает с выбранной позицией и размером" },
      { status: 400 },
    );
  }
  const normalizedItems = data.items.map((item) => ({
    ...item,
    purchasePricePerUnit: item.sourceReturnId ? 0 : item.purchasePricePerUnit,
  }));
  const productsById = new Map(products.map((product) => [product.id, product]));
  const counterparty = await prisma.counterparty.findUnique({
    where: { id: data.counterpartyId },
  });
  const avitoProfile = data.marketplace === "AVITO" && data.avitoProfileId
    ? await prisma.avitoProfile.findUnique({ where: { id: data.avitoProfileId } })
    : null;
  if (!counterparty) {
    return NextResponse.json({ error: "Контрагент не найден" }, { status: 404 });
  }
  if (data.marketplace === "AVITO" && data.avitoProfileId && (!avitoProfile || !avitoProfile.isActive)) {
    return NextResponse.json({ error: "Avito profile not found" }, { status: 404 });
  }

  const firstItem = normalizedItems[0];
  const firstProduct = productsById.get(firstItem.productId)!;
  const totals = getLegacyOrderTotals(normalizedItems);
  const carrier =
    data.carrier?.trim() || detectCarrier(data.trackingNumber)?.carrier || "";

  let order: Order | null = null;
  for (let attempt = 0; attempt < 3 && !order; attempt++) {
    const orderNumber = await generateOrderNumber();
    try {
      order = await prisma.$transaction(async (tx) => {
        const created = await tx.order.create({
          data: {
            orderNumber,
            marketplace: data.marketplace,
            productId: firstProduct.id,
            productNameSnapshot:
              normalizedItems.length === 1
                ? firstProduct.name
                : `${firstProduct.name} + ещё ${normalizedItems.length - 1}`,
            variant: firstItem.variant || null,
            size: firstItem.size || null,
            quantity: totals.quantity,
            salePriceAtOrder: totals.salePriceAtOrder,
            counterpartyId: data.counterpartyId,
            avitoProfileId: data.marketplace === "AVITO" ? data.avitoProfileId ?? null : null,
            purchasePricePerUnit: totals.purchasePricePerUnit,
            purchaseComment: data.purchaseComment,
            trackingNumber: data.trackingNumber,
            carrier,
            orderDate: new Date(data.orderDate),
            shippingDate: data.shippingDate ? new Date(data.shippingDate) : null,
            destinationCity: data.destinationCity,
            logisticsCost: data.logisticsCost,
            commissionCost: data.commissionCost,
            otherCosts: data.otherCosts,
            createdByUserId: session.user.id,
            items: {
              create: normalizedItems.map((item, position) => ({
                productId: item.productId,
                productNameSnapshot: productsById.get(item.productId)!.name,
                variant: item.variant || null,
                size: item.size || null,
                quantity: item.quantity,
                salePriceAtOrder: item.salePriceAtOrder,
                purchasePricePerUnit: item.purchasePricePerUnit,
                imageUrls: item.imageUrls,
                sourceReturnId: item.sourceReturnId ?? null,
                position,
              })),
            },
            notification: { create: {} },
          },
        });
        await createAuditLog(
          {
            entityType: "ORDER",
            entityId: created.id,
            userId: session.user.id,
            fieldName: "status",
            oldValue: null,
            newValue: "ACCEPTED",
          },
          tx
        );
        return created;
      });
    } catch (error) {
      const duplicateOrderNumber =
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002" &&
        String(error.meta?.target ?? "").includes("orderNumber");
      if (!duplicateOrderNumber || attempt === 2) throw error;
    }
  }
  if (!order) {
    return NextResponse.json(
      { error: "Не удалось сформировать номер заказа" },
      { status: 409 }
    );
  }

  await processOrderNotificationByOrderId(order.id);

  return NextResponse.json(order, { status: 201 });
}
