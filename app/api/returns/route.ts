import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db/prisma";
import { createAuditLog } from "@/lib/db/audit";
import { getStatusFinancialUpdate } from "@/lib/orders/status";
import { z } from "zod";

const createReturnSchema = z.object({
  trackingNumber: z.string().trim().min(1),
  productId: z.string().uuid(),
  productNameSnapshot: z.string().trim().min(1),
  variant: z.string().trim().optional(),
  size: z.string().trim().optional(),
  shippingDate: z.string().date().nullable().optional(),
  reason: z.string().trim().min(1),
  comment: z.string().trim().optional(),
});

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status");
  const search = searchParams.get("search");
  const reason = searchParams.get("reason");

  const where: Prisma.ReturnWhereInput = {
    AND: [{ OR: [{ orderId: null }, { order: { isDeleted: false } }] }],
  };
  if (status) {
    const parsedStatus = z.enum(["RETURNING", "RETURNED", "CANCELLED"]).safeParse(status);
    if (!parsedStatus.success) {
      return NextResponse.json({ error: "Некорректный статус" }, { status: 400 });
    }
    where.status = parsedStatus.data;
  }
  if (reason) where.reason = { contains: reason, mode: "insensitive" };
  if (search) {
    const and = Array.isArray(where.AND) ? where.AND : [where.AND!];
    where.AND = [
      ...and,
      {
        OR: [
          { trackingNumber: { contains: search, mode: "insensitive" } },
          { productNameSnapshot: { contains: search, mode: "insensitive" } },
        ],
      },
    ];
  }

  const returns = await prisma.return.findMany({
    where,
    include: {
      order: true,
      product: true,
      usedByOrderItems: {
        select: { order: { select: { orderNumber: true } } },
        take: 1,
      },
    },
    orderBy: { createdAt: "desc" },
  });

  const [totalReturning, totalReturned] = await Promise.all([
    prisma.return.count({
      where: {
        status: "RETURNING",
        OR: [{ orderId: null }, { order: { isDeleted: false } }],
      },
    }),
    prisma.return.count({
      where: {
        status: "RETURNED",
        usedByOrderItems: { none: {} },
        OR: [{ orderId: null }, { order: { isDeleted: false } }],
      },
    }),
  ]);

  return NextResponse.json({ returns, totalReturning, totalReturned, total: returns.length });
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = createReturnSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const data = parsed.data;
  const [matchingOrder, product] = await Promise.all([
    prisma.order.findFirst({
      where: {
        trackingNumber: { equals: data.trackingNumber, mode: "insensitive" },
        isDeleted: false,
      },
      include: { items: { orderBy: { position: "asc" }, take: 1 } },
    }),
    prisma.product.findUnique({ where: { id: data.productId } }),
  ]);
  if (!product) {
    return NextResponse.json({ error: "Товар не найден" }, { status: 404 });
  }

  const orderItem = matchingOrder?.items[0];
  const existing = await prisma.return.findFirst({
    where: {
      status: { in: ["RETURNING", "RETURNED"] },
      OR: [
        ...(matchingOrder ? [{ orderId: matchingOrder.id }] : []),
        {
          trackingNumber: {
            equals: data.trackingNumber,
            mode: "insensitive",
          },
        },
      ],
    },
  });
  if (existing) {
    return NextResponse.json({ error: "Возврат для этого заказа уже оформлен" }, { status: 409 });
  }

  const returnedAt = new Date();
  const created = await prisma.$transaction(async (tx) => {
    const ret = await tx.return.create({
      data: {
        orderId: matchingOrder?.id ?? null,
        productId: matchingOrder?.productId ?? data.productId,
        productNameSnapshot:
          orderItem?.productNameSnapshot ??
          matchingOrder?.productNameSnapshot ??
          data.productNameSnapshot,
        variant: orderItem?.variant ?? matchingOrder?.variant ?? data.variant ?? null,
        size: orderItem?.size ?? matchingOrder?.size ?? data.size ?? null,
        trackingNumber: data.trackingNumber,
        status: "RETURNED",
        shippingDate: data.shippingDate ? new Date(data.shippingDate) : null,
        returnDate: returnedAt,
        reason: data.reason,
        comment: data.comment,
      },
    });

    if (matchingOrder && matchingOrder.status !== "RETURNED") {
      const financialUpdate = getStatusFinancialUpdate("RETURNED");
      await tx.order.update({
        where: { id: matchingOrder.id },
        data: { status: "RETURNED", ...financialUpdate.order },
      });
      await tx.orderItem.updateMany({
        where: { orderId: matchingOrder.id },
        data: financialUpdate.items!,
      });
      await createAuditLog(
        {
          entityType: "ORDER",
          entityId: matchingOrder.id,
          userId: session.user.id,
          fieldName: "status",
          oldValue: matchingOrder.status,
          newValue: "RETURNED",
        },
        tx,
      );
    }
    return ret;
  });

  return NextResponse.json(created, { status: 201 });
}
