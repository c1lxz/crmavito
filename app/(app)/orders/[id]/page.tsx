import { notFound } from "next/navigation";
import { prisma } from "@/lib/db/prisma";
import { OrderDetailClient } from "@/components/orders/order-detail-client";
import { calcOrderFinancials } from "@/lib/finance/calculations";
import { toDecimalNumber } from "@/lib/db/orders";
import { sanitizeOrderFilterQuery } from "@/lib/orders/filters";

export default async function OrderDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ returnTo?: string }>;
}) {
  const { id } = await params;
  const query = await searchParams;
  const returnQuery = sanitizeOrderFilterQuery(query.returnTo ?? "");
  const returnHref = returnQuery ? `/orders?${returnQuery}` : "/orders";
  const [order, products, counterparties, avitoProfiles] = await Promise.all([
    prisma.order.findUnique({
      where: { id, isDeleted: false },
      include: {
        product: true,
        counterparty: true,
        avitoProfile: true,
        items: {
          include: {
            product: true,
            sourceReturn: { select: { trackingNumber: true } },
          },
          orderBy: { position: "asc" },
        },
        returns: true,
        auditLogs: { include: { user: { select: { name: true } } }, orderBy: { timestamp: "desc" } },
      },
    }),
    prisma.product.findMany({ orderBy: { name: "asc" } }),
    prisma.counterparty.findMany({ orderBy: { name: "asc" } }),
    prisma.avitoProfile.findMany({ orderBy: [{ isActive: "desc" }, { name: "asc" }] }),
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
        avitoProfile: order.avitoProfile
          ? {
              id: order.avitoProfile.id,
              name: order.avitoProfile.name,
              color: order.avitoProfile.color,
              isActive: order.avitoProfile.isActive,
            }
          : null,
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
          sourceReturn: item.sourceReturn,
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
      avitoProfiles={avitoProfiles.map((profile) => ({
        id: profile.id,
        name: profile.name,
        color: profile.color,
        isActive: profile.isActive,
      }))}
      returnHref={returnHref}
    />
  );
}
