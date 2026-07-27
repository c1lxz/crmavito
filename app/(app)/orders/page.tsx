import { Suspense } from "react";
import { prisma } from "@/lib/db/prisma";
import { OrdersClient } from "@/components/orders/orders-client";
import { calcOrderFinancials } from "@/lib/finance/calculations";
import { toDecimalNumber } from "@/lib/db/orders";
import { getWarehouseBlockingOrderWhere } from "@/lib/orders/warehouse-match";

async function getOrders() {
  const orders = await prisma.order.findMany({
    where: { isDeleted: false },
    include: {
      product: true,
      counterparty: true,
      avitoProfile: true,
      items: { include: { product: true }, orderBy: { position: "asc" } },
    },
    orderBy: { createdAt: "desc" },
  });
  return orders.map((o) => ({
    ...o,
    orderDate: o.orderDate.toISOString(),
    shippingDate: o.shippingDate ? o.shippingDate.toISOString() : null,
    receivedAt: o.receivedAt ? o.receivedAt.toISOString() : null,
    createdAt: o.createdAt.toISOString(),
    updatedAt: o.updatedAt.toISOString(),
    product: {
      id: o.product.id,
      name: o.product.name,
      salePrice: toDecimalNumber(o.product.salePrice),
      avitoListingUrl: o.product.avitoListingUrl,
      avitoListingStatus: o.product.avitoListingStatus,
      avitoItemId: o.product.avitoItemId,
      imageUrl: o.product.imageUrl,
      lastSyncedAt: o.product.lastSyncedAt ? o.product.lastSyncedAt.toISOString() : null,
      createdAt: o.product.createdAt.toISOString(),
      updatedAt: o.product.updatedAt.toISOString(),
    },
    counterparty: {
      id: o.counterparty.id,
      name: o.counterparty.name,
      contactInfo: o.counterparty.contactInfo,
      comment: o.counterparty.comment,
      createdAt: o.counterparty.createdAt.toISOString(),
    },
    avitoProfile: o.avitoProfile
      ? {
          id: o.avitoProfile.id,
          name: o.avitoProfile.name,
          color: o.avitoProfile.color,
          isActive: o.avitoProfile.isActive,
        }
      : null,
    items: o.items.map((item) => ({
      id: item.id,
      imageUrls: item.imageUrls,
      sourceReturnId: item.sourceReturnId,
      product: {
        imageUrl: item.product.imageUrl,
      },
    })),
    ...calcOrderFinancials({
      salePriceAtOrder: toDecimalNumber(o.salePriceAtOrder),
      quantity: o.quantity,
      purchasePricePerUnit: toDecimalNumber(o.purchasePricePerUnit),
      logisticsCost: toDecimalNumber(o.logisticsCost),
      commissionCost: toDecimalNumber(o.commissionCost),
      otherCosts: toDecimalNumber(o.otherCosts),
    }),
    salePriceAtOrder: toDecimalNumber(o.salePriceAtOrder),
    purchasePricePerUnit: toDecimalNumber(o.purchasePricePerUnit),
    logisticsCost: toDecimalNumber(o.logisticsCost),
    commissionCost: toDecimalNumber(o.commissionCost),
    otherCosts: toDecimalNumber(o.otherCosts),
  }));
}

async function getCounterparties() {
  const counterparties = await prisma.counterparty.findMany({ orderBy: { name: "asc" } });
  return counterparties.map((c) => ({
    id: c.id,
    name: c.name,
  }));
}

async function getProducts() {
  const products = await prisma.product.findMany({ orderBy: { name: "asc" } });
  return products.map((p) => ({ id: p.id, name: p.name, salePrice: parseFloat(p.salePrice.toString()), imageUrl: p.imageUrl }));
}

async function getAvitoProfiles() {
  return prisma.avitoProfile.findMany({
    where: { isActive: true },
    orderBy: { name: "asc" },
  });
}

async function getDepositedReturns() {
  const returns = await prisma.return.findMany({
    where: {
      status: "RETURNED",
      usedByOrderItems: {
        none: { order: getWarehouseBlockingOrderWhere() },
      },
      OR: [{ orderId: null }, { order: { isDeleted: false } }],
    },
    select: {
      id: true,
      productId: true,
      productNameSnapshot: true,
      size: true,
      variant: true,
      trackingNumber: true,
    },
    orderBy: [{ returnDate: "asc" }, { createdAt: "asc" }],
  });
  return returns;
}

export default async function OrdersPage({
  searchParams,
}: {
  searchParams: Promise<{
    new?: string;
    search?: string;
    q?: string;
    status?: string;
    counterpartyId?: string;
    avitoProfileId?: string;
    marketplace?: string;
    warehouse?: string;
    dateFrom?: string;
    dateTo?: string;
  }>;
}) {
  const query = await searchParams;
  const [orders, counterparties, products, depositedReturns, avitoProfiles] = await Promise.all([
    getOrders(),
    getCounterparties(),
    getProducts(),
    getDepositedReturns(),
    getAvitoProfiles(),
  ]);

  return (
    <Suspense fallback={<div className="p-4 text-center">Загрузка...</div>}>
      <OrdersClient
        initialOrders={orders}
        counterparties={counterparties}
        products={products}
        avitoProfiles={avitoProfiles}
        depositedReturns={depositedReturns}
        initialOpen={query.new === "1"}
        focusSearch={query.search === "1"}
        initialSearch={query.q}
        initialStatusFilter={query.status}
        initialCounterpartyFilter={query.counterpartyId}
        initialAvitoProfileFilter={query.avitoProfileId}
        initialMarketplaceFilter={query.marketplace}
        initialWarehouseOnly={query.warehouse === "1"}
        initialDateFrom={query.dateFrom}
        initialDateTo={query.dateTo}
      />
    </Suspense>
  );
}
