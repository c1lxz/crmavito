import { prisma } from "./prisma";
import { calcOrderFinancials, sumFinancials } from "@/lib/finance/calculations";
import { toDecimalNumber } from "./orders";

export interface DateRange {
  from: Date;
  to: Date;
}

async function getActiveOrders(range: DateRange, city?: string) {
  return prisma.order.findMany({
    where: {
      isDeleted: false,
      orderDate: { gte: range.from, lte: range.to },
      ...(city ? { destinationCity: city } : {}),
    },
    include: {
      product: true,
      counterparty: true,
      items: { include: { product: true }, orderBy: { position: "asc" } },
    },
  });
}

async function getReceivedOrders(range: DateRange, city?: string) {
  return prisma.order.findMany({
    where: {
      status: "RECEIVED",
      isDeleted: false,
      receivedAt: { gte: range.from, lte: range.to },
      ...(city ? { destinationCity: city } : {}),
    },
    include: {
      product: true,
      counterparty: true,
      items: { include: { product: true }, orderBy: { position: "asc" } },
    },
  });
}

export async function getKpiForRange(range: DateRange, city?: string) {
  const orders = await getActiveOrders(range, city);
  const financials = orders.map((o) =>
    calcOrderFinancials({
      salePriceAtOrder: toDecimalNumber(o.salePriceAtOrder),
      quantity: o.quantity,
      purchasePricePerUnit: toDecimalNumber(o.purchasePricePerUnit),
      logisticsCost: toDecimalNumber(o.logisticsCost),
      commissionCost: toDecimalNumber(o.commissionCost),
      otherCosts: toDecimalNumber(o.otherCosts),
    })
  );
  const totals = sumFinancials(financials);
  const avgCheck = orders.length > 0 ? totals.revenue / orders.length : 0;

  const returns = await prisma.return.count({
    where: {
      status: "RETURNED",
      createdAt: { gte: range.from, lte: range.to },
      order: { isDeleted: false },
    },
  });
  const allOrdersInPeriod = await prisma.order.count({
    where: { isDeleted: false, orderDate: { gte: range.from, lte: range.to } },
  });

  return {
    ...totals,
    ordersCount: orders.length,
    avgCheck: Math.round(avgCheck * 100) / 100,
    returnsCount: returns,
    returnsPercent: allOrdersInPeriod > 0 ? (returns / allOrdersInPeriod) * 100 : 0,
  };
}

export async function getPnL(range: DateRange) {
  const orders = await getReceivedOrders(range);
  const financials = orders.map((o) =>
    calcOrderFinancials({
      salePriceAtOrder: toDecimalNumber(o.salePriceAtOrder),
      quantity: o.quantity,
      purchasePricePerUnit: toDecimalNumber(o.purchasePricePerUnit),
      logisticsCost: toDecimalNumber(o.logisticsCost),
      commissionCost: toDecimalNumber(o.commissionCost),
      otherCosts: toDecimalNumber(o.otherCosts),
    })
  );
  const orderTotals = sumFinancials(financials);

  const orderLogistics = orders.reduce(
    (s, o) => s + toDecimalNumber(o.logisticsCost),
    0
  );
  const orderCommission = orders.reduce(
    (s, o) => s + toDecimalNumber(o.commissionCost),
    0
  );

  const expenses = await prisma.expense.findMany({
    where: { date: { gte: range.from, lte: range.to } },
  });

  const expByCategory = expenses.reduce(
    (acc, e) => {
      const cat = e.category;
      acc[cat] = (acc[cat] ?? 0) + toDecimalNumber(e.amount);
      return acc;
    },
    {} as Record<string, number>
  );

  const totalLogistics = orderLogistics + (expByCategory["LOGISTICS"] ?? 0);
  const totalCommission = orderCommission + (expByCategory["AVITO_COMMISSION"] ?? 0);
  const advertising = expByCategory["ADVERTISING"] ?? 0;
  const otherExpenses =
    (expByCategory["SALARY"] ?? 0) +
    (expByCategory["PACKAGING"] ?? 0) +
    (expByCategory["OTHER"] ?? 0) +
    (expByCategory["PURCHASE"] ?? 0);

  const netProfit =
    orderTotals.revenue -
    orderTotals.costOfGoods -
    totalLogistics -
    totalCommission -
    advertising -
    otherExpenses;

  return {
    revenue: orderTotals.revenue,
    costOfGoods: orderTotals.costOfGoods,
    logistics: totalLogistics,
    commission: totalCommission,
    advertising,
    otherExpenses,
    netProfit,
  };
}

export async function getProductsReport(range: DateRange) {
  const orders = await getReceivedOrders(range);
  const byProduct: Record<
    string,
    { name: string; imageUrl: string | null; sold: number; revenue: number; profit: number }
  > = {};

  for (const o of orders) {
    const items = o.items.length
      ? o.items
      : [{
          productId: o.productId,
          productNameSnapshot: o.productNameSnapshot,
          quantity: o.quantity,
          salePriceAtOrder: o.salePriceAtOrder,
          purchasePricePerUnit: o.purchasePricePerUnit,
          product: o.product,
        }];
    const orderRevenue = items.reduce(
      (sum, item) => sum + toDecimalNumber(item.salePriceAtOrder) * item.quantity,
      0
    );
    const sharedCosts =
      toDecimalNumber(o.logisticsCost) +
      toDecimalNumber(o.commissionCost) +
      toDecimalNumber(o.otherCosts);

    for (const item of items) {
      const revenue = toDecimalNumber(item.salePriceAtOrder) * item.quantity;
      const cost = toDecimalNumber(item.purchasePricePerUnit) * item.quantity;
      const allocatedCosts = orderRevenue > 0 ? sharedCosts * (revenue / orderRevenue) : 0;
      if (!byProduct[item.productId]) {
        byProduct[item.productId] = {
          name: item.productNameSnapshot,
          imageUrl: item.product.imageUrl,
          sold: 0,
          revenue: 0,
          profit: 0,
        };
      }
      byProduct[item.productId].sold += item.quantity;
      byProduct[item.productId].revenue += revenue;
      byProduct[item.productId].profit += revenue - cost - allocatedCosts;
    }
  }

  return Object.entries(byProduct)
    .map(([id, d]) => ({ productId: id, ...d }))
    .sort((a, b) => b.profit - a.profit);
}

export async function getCounterpartiesReport(range: DateRange) {
  const orders = await prisma.order.findMany({
    where: { isDeleted: false, orderDate: { gte: range.from, lte: range.to } },
    include: { counterparty: true },
  });

  const byCounterparty: Record<
    string,
    {
      name: string;
      purchased: number;
      revenue: number;
      profit: number;
    }
  > = {};

  for (const o of orders) {
    const fin = calcOrderFinancials({
      salePriceAtOrder: toDecimalNumber(o.salePriceAtOrder),
      quantity: o.quantity,
      purchasePricePerUnit: toDecimalNumber(o.purchasePricePerUnit),
      logisticsCost: toDecimalNumber(o.logisticsCost),
      commissionCost: toDecimalNumber(o.commissionCost),
      otherCosts: toDecimalNumber(o.otherCosts),
    });

    const cid = o.counterpartyId;
    if (!byCounterparty[cid]) {
      byCounterparty[cid] = {
        name: o.counterparty.name,
        purchased: 0,
        revenue: 0,
        profit: 0,
      };
    }
    byCounterparty[cid].purchased += fin.costOfGoods;
    if (o.status === "RECEIVED") {
      byCounterparty[cid].revenue += fin.revenue;
      byCounterparty[cid].profit += fin.netProfit;
    }
  }

  return Object.entries(byCounterparty).map(([id, d]) => ({
    counterpartyId: id,
    ...d,
  }));
}

export async function getReturnsReport(range: DateRange) {
  const returns = await prisma.return.findMany({
    where: {
      createdAt: { gte: range.from, lte: range.to },
      order: { isDeleted: false },
    },
    include: { product: true },
  });

  const totalByProduct: Record<string, { name: string; returns: number }> = {};
  for (const r of returns) {
    if (!totalByProduct[r.productId]) {
      totalByProduct[r.productId] = { name: r.product.name, returns: 0 };
    }
    totalByProduct[r.productId].returns += 1;
  }

  const totalOrdersByProduct = await prisma.order.groupBy({
    by: ["productId", "productNameSnapshot"],
    where: {
      isDeleted: false,
      receivedAt: { gte: range.from, lte: range.to },
    },
    _count: true,
  });

  return Object.entries(totalByProduct).map(([productId, d]) => {
    const totalOrders =
      totalOrdersByProduct.find((o) => o.productId === productId)?._count ?? 0;
    return {
      productId,
      name: d.name,
      returns: d.returns,
      returnPercent: totalOrders > 0 ? (d.returns / totalOrders) * 100 : 0,
    };
  });
}

export async function getOrderStatusCounts(range: DateRange) {
  const counts = await prisma.order.groupBy({
    by: ["status"],
    where: { isDeleted: false, orderDate: { gte: range.from, lte: range.to } },
    _count: { _all: true },
  });
  const result: Record<string, number> = {};
  for (const c of counts) result[c.status] = c._count._all;
  return result;
}

export async function getExpenseCategoryTotals(range: DateRange) {
  const expenses = await prisma.expense.findMany({
    where: { date: { gte: range.from, lte: range.to } },
    select: { category: true, amount: true },
  });
  const result: Record<string, number> = {};
  for (const e of expenses) {
    result[e.category] = (result[e.category] ?? 0) + toDecimalNumber(e.amount);
  }
  return result;
}

export async function getDynamicsChart(range: DateRange) {
  const orders = await getReceivedOrders(range);
  const byDay: Record<string, { revenue: number; profit: number }> = {};

  for (const o of orders) {
    const fin = calcOrderFinancials({
      salePriceAtOrder: toDecimalNumber(o.salePriceAtOrder),
      quantity: o.quantity,
      purchasePricePerUnit: toDecimalNumber(o.purchasePricePerUnit),
      logisticsCost: toDecimalNumber(o.logisticsCost),
      commissionCost: toDecimalNumber(o.commissionCost),
      otherCosts: toDecimalNumber(o.otherCosts),
    });
    const day = (o.receivedAt ?? o.orderDate).toISOString().slice(0, 10);
    if (!byDay[day]) byDay[day] = { revenue: 0, profit: 0 };
    byDay[day].revenue += fin.revenue;
    byDay[day].profit += fin.netProfit;
  }

  return Object.entries(byDay)
    .map(([date, d]) => ({ date, ...d }))
    .sort((a, b) => a.date.localeCompare(b.date));
}
