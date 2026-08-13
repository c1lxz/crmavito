import { Suspense } from "react";
import { prisma } from "@/lib/db/prisma";
import { OrdersClient } from "@/components/orders/orders-client";
import { getWarehouseBlockingOrderWhere } from "@/lib/orders/warehouse-match";
import { getOrderList } from "@/lib/orders/list";
import { parseDatabaseDateInput } from "@/lib/utils";

async function getCounterparties() {
  const counterparties = await prisma.counterparty.findMany({ orderBy: { name: "asc" } });
  return counterparties.map((c) => ({
    id: c.id,
    name: c.name,
  }));
}

async function getProducts() {
  const products = await prisma.product.findMany({
    select: { id: true, name: true, salePrice: true, imageUrl: true },
    orderBy: { name: "asc" },
  });
  return products.map((p) => ({ id: p.id, name: p.name, salePrice: parseFloat(p.salePrice.toString()), imageUrl: p.imageUrl }));
}

async function getAvitoProfiles() {
  return prisma.avitoProfile.findMany({
    where: { isActive: true },
    select: { id: true, name: true, color: true, isActive: true },
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
  const validStatuses = new Set(["ACCEPTED", "SHIPPED", "RECEIVED", "RETURNING", "RETURNED", "CANCELLED"]);
  const status = query.status && validStatuses.has(query.status) ? query.status : undefined;
  const marketplace = query.marketplace === "AVITO" || query.marketplace === "WB" ? query.marketplace : undefined;
  const validDate = (value?: string) => value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : undefined;
  const dateFrom = validDate(query.dateFrom);
  const dateTo = validDate(query.dateTo);
  const [orderList, counterparties, products, depositedReturns, avitoProfiles] = await Promise.all([
    getOrderList({
      q: query.q,
      status,
      counterpartyId: query.counterpartyId,
      avitoProfileId: query.avitoProfileId,
      marketplace,
      warehouseOnly: query.warehouse === "1",
      dateFrom: dateFrom ? parseDatabaseDateInput(dateFrom) : undefined,
      dateTo: dateTo ? parseDatabaseDateInput(dateTo, true) : undefined,
    }),
    getCounterparties(),
    getProducts(),
    getDepositedReturns(),
    getAvitoProfiles(),
  ]);

  return (
    <Suspense fallback={<div className="p-4 text-center">Загрузка...</div>}>
      <OrdersClient
        initialOrders={orderList.orders}
        initialTotal={orderList.total}
        initialSummary={orderList.summary}
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
