import { prisma } from "@/lib/db/prisma";
import { ReturnsClient } from "@/components/returns/returns-client";
import { toDecimalNumber } from "@/lib/db/orders";

async function getReturns() {
  const visibleReturnWhere = {
    OR: [
      { orderId: null },
      { order: { isDeleted: false, status: { not: "CANCELLED" as const } } },
    ],
  };
  const [returns, totalReturning, totalReturned, products] = await Promise.all([
    prisma.return.findMany({
      where: visibleReturnWhere,
      include: {
        order: true,
        product: true,
        usedByOrderItems: {
          select: { order: { select: { orderNumber: true } } },
          take: 1,
        },
      },
      orderBy: { createdAt: "desc" },
    }),
    prisma.return.count({ where: { status: "RETURNING", ...visibleReturnWhere } }),
    prisma.return.count({
      where: {
        status: "RETURNED",
        ...visibleReturnWhere,
      },
    }),
    prisma.product.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true, imageUrl: true },
    }),
  ]);
  return {
    returns: returns.map((r) => ({
      ...r,
      productNameSnapshot:
        r.productNameSnapshot || r.order?.productNameSnapshot || r.product.name,
      variant: r.variant ?? r.order?.variant ?? null,
      size: r.size ?? r.order?.size ?? null,
      shippingDate: r.shippingDate ? r.shippingDate.toISOString() : null,
      returnDate: r.returnDate ? r.returnDate.toISOString() : null,
      createdAt: r.createdAt.toISOString(),
      order: r.order ? {
        ...r.order,
        salePriceAtOrder: toDecimalNumber(r.order.salePriceAtOrder),
        purchasePricePerUnit: toDecimalNumber(r.order.purchasePricePerUnit),
        logisticsCost: toDecimalNumber(r.order.logisticsCost),
        commissionCost: toDecimalNumber(r.order.commissionCost),
        otherCosts: toDecimalNumber(r.order.otherCosts),
        orderDate: r.order.orderDate.toISOString(),
        shippingDate: r.order.shippingDate ? r.order.shippingDate.toISOString() : null,
        receivedAt: r.order.receivedAt ? r.order.receivedAt.toISOString() : null,
        createdAt: r.order.createdAt.toISOString(),
        updatedAt: r.order.updatedAt.toISOString(),
      } : null,
    })),
    totalReturning,
    totalReturned,
    products,
  };
}

export default async function ReturnsPage() {
  const data = await getReturns();
  return <ReturnsClient initialData={data} />;
}
