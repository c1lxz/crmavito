import { Suspense } from "react";
import { prisma } from "@/lib/db/prisma";
import { OrdersClient } from "@/components/orders/orders-client";
import { calcOrderFinancials, sumFinancials } from "@/lib/finance/calculations";
import { toDecimalNumber } from "@/lib/db/orders";
import type { OrderStatus } from "@prisma/client";

async function getOrders() {
  const orders = await prisma.order.findMany({
    where: { isDeleted: false },
    include: { product: true, counterparty: true },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  return orders.map((o) => ({
    ...o,
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
  return prisma.counterparty.findMany({ orderBy: { name: "asc" } });
}

async function getProducts() {
  const products = await prisma.product.findMany({ orderBy: { name: "asc" }, take: 200 });
  return products.map((p) => ({ id: p.id, name: p.name, salePrice: parseFloat(p.salePrice.toString()), imageUrl: p.imageUrl }));
}

export default async function OrdersPage() {
  const [orders, counterparties, products] = await Promise.all([
    getOrders(),
    getCounterparties(),
    getProducts(),
  ]);

  const receivedOrders = orders.filter((o) => o.status === "RECEIVED" as OrderStatus);
  const totals = sumFinancials(receivedOrders);

  return (
    <Suspense fallback={<div className="p-4 text-center">Загрузка...</div>}>
      <OrdersClient
        initialOrders={orders}
        counterparties={counterparties}
        products={products}
        totalRevenue={orders.reduce((s, o) => s + o.revenue, 0)}
        totalProfit={totals.netProfit}
      />
    </Suspense>
  );
}
