import { prisma } from "@/lib/db/prisma";
import { ReturnsClient } from "@/components/returns/returns-client";
import { toDecimalNumber } from "@/lib/db/orders";

async function getReturns() {
  const [returns, totalReturning, totalReturned] = await Promise.all([
    prisma.return.findMany({
      where: { order: { isDeleted: false } },
      include: { order: true, product: true },
      orderBy: { createdAt: "desc" },
    }),
    prisma.return.count({ where: { status: "RETURNING", order: { isDeleted: false } } }),
    prisma.return.count({ where: { status: "RETURNED", order: { isDeleted: false } } }),
  ]);
  return {
    returns: returns.map((r) => ({
      ...r,
      shippingDate: r.shippingDate ? r.shippingDate.toISOString() : null,
      returnDate: r.returnDate ? r.returnDate.toISOString() : null,
      createdAt: r.createdAt.toISOString(),
      order: {
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
      },
    })),
    totalReturning,
    totalReturned,
  };
}

export default async function ReturnsPage() {
  const data = await getReturns();
  return <ReturnsClient initialData={data} />;
}
