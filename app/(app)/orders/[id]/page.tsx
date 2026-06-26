import { notFound } from "next/navigation";
import { prisma } from "@/lib/db/prisma";
import { OrderDetailClient } from "@/components/orders/order-detail-client";
import { calcOrderFinancials } from "@/lib/finance/calculations";
import { toDecimalNumber, getAllowedNextStatuses } from "@/lib/db/orders";

export default async function OrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const order = await prisma.order.findUnique({
    where: { id, isDeleted: false },
    include: {
      product: true,
      counterparty: true,
      returns: true,
      auditLogs: { include: { user: { select: { name: true } } }, orderBy: { timestamp: "desc" } },
    },
  });

  if (!order) notFound();

  const fin = calcOrderFinancials({
    salePriceAtOrder: toDecimalNumber(order.salePriceAtOrder),
    quantity: order.quantity,
    purchasePricePerUnit: toDecimalNumber(order.purchasePricePerUnit),
    logisticsCost: toDecimalNumber(order.logisticsCost),
    commissionCost: toDecimalNumber(order.commissionCost),
    otherCosts: toDecimalNumber(order.otherCosts),
  });

  const nextStatuses = getAllowedNextStatuses(order.status);

  return (
    <OrderDetailClient
      order={{
        ...order,
        salePriceAtOrder: toDecimalNumber(order.salePriceAtOrder),
        purchasePricePerUnit: toDecimalNumber(order.purchasePricePerUnit),
        logisticsCost: toDecimalNumber(order.logisticsCost),
        commissionCost: toDecimalNumber(order.commissionCost),
        otherCosts: toDecimalNumber(order.otherCosts),
        orderDate: order.orderDate.toISOString(),
        shippingDate: order.shippingDate?.toISOString() ?? null,
        receivedAt: order.receivedAt?.toISOString() ?? null,
        createdAt: order.createdAt.toISOString(),
        updatedAt: order.updatedAt.toISOString(),
        auditLogs: order.auditLogs.map((l: (typeof order.auditLogs)[number]) => ({
          ...l,
          timestamp: l.timestamp.toISOString(),
          createdAt: l.createdAt.toISOString(),
        })),
      }}
      financials={fin}
      nextStatuses={nextStatuses}
    />
  );
}
