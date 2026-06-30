import { notFound } from "next/navigation";
import { prisma } from "@/lib/db/prisma";
import { OrderDetailClient } from "@/components/orders/order-detail-client";
import { calcOrderFinancials } from "@/lib/finance/calculations";
import { toDecimalNumber } from "@/lib/db/orders";

export default async function OrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [order, products, counterparties] = await Promise.all([
    prisma.order.findUnique({
      where: { id, isDeleted: false },
      include: {
        product: true,
        counterparty: true,
        items: { include: { product: true }, orderBy: { position: "asc" } },
        returns: true,
        auditLogs: { include: { user: { select: { name: true } } }, orderBy: { timestamp: "desc" } },
      },
    }),
    prisma.product.findMany({ orderBy: { name: "asc" } }),
    prisma.counterparty.findMany({ orderBy: { name: "asc" } }),
  ]);

  if (!order) notFound();

  const fin = calcOrderFinancials({
    salePriceAtOrder: toDecimalNumber(order.salePriceAtOrder),
    quantity: order.quantity,
    purchasePricePerUnit: toDecimalNumber(order.purchasePricePerUnit),
    logisticsCost: toDecimalNumber(order.logisticsCost),
    commissionCost: toDecimalNumber(order.commissionCost),
    otherCosts: toDecimalNumber(order.otherCosts),
  });

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
        items: order.items.map((item) => ({
          ...item,
          salePriceAtOrder: toDecimalNumber(item.salePriceAtOrder),
          purchasePricePerUnit: toDecimalNumber(item.purchasePricePerUnit),
          createdAt: item.createdAt.toISOString(),
          updatedAt: item.updatedAt.toISOString(),
          product: {
            name: item.product.name,
            imageUrl: item.product.imageUrl,
          },
        })),
        auditLogs: order.auditLogs.map((l: (typeof order.auditLogs)[number]) => ({
          ...l,
          timestamp: l.timestamp.toISOString(),
          createdAt: l.createdAt.toISOString(),
        })),
      }}
      financials={fin}
      products={products.map((product) => ({
        id: product.id,
        name: product.name,
        salePrice: toDecimalNumber(product.salePrice),
        imageUrl: product.imageUrl,
      }))}
      counterparties={counterparties.map((counterparty) => ({
        id: counterparty.id,
        name: counterparty.name,
      }))}
    />
  );
}
