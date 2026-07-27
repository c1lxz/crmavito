import { prisma } from "./prisma";
import { calcOrderFinancials, sumFinancials } from "@/lib/finance/calculations";
import { toDecimalNumber } from "./orders";
import {
  endOfDatabaseDate,
  formatDateInput,
  startOfDatabaseDate,
} from "@/lib/utils";
import type { Marketplace, Prisma } from "@prisma/client";
import {
  getArchivedReturnExclusion,
  getArchivedSourceOrderExclusion,
} from "@/lib/orders/warehouse-match";

export interface DateRange {
  from: Date;
  to: Date;
}

function getDatabaseDateRange(range: DateRange): DateRange {
  return {
    from: startOfDatabaseDate(range.from),
    to: endOfDatabaseDate(range.to),
  };
}

function getReportReturnWhere(
  range: DateRange,
  marketplace?: Marketplace,
  city?: string,
): Prisma.ReturnWhereInput {
  const dateRange = getDatabaseDateRange(range);
  const validOrder: Prisma.OrderWhereInput = {
    isDeleted: false,
    status: { not: "CANCELLED" },
    ...(marketplace ? { marketplace } : {}),
    ...(city ? { destinationCity: city } : {}),
  };

  return {
    status: "RETURNED",
    returnDate: { gte: dateRange.from, lte: dateRange.to },
    ...getArchivedReturnExclusion(),
    ...(marketplace || city
      ? { order: validOrder }
      : { OR: [{ orderId: null }, { order: validOrder }] }),
  };
}

async function getActiveOrders(range: DateRange, city?: string, marketplace?: Marketplace) {
  const dateRange = getDatabaseDateRange(range);
  return prisma.order.findMany({
    where: {
      isDeleted: false,
      status: { not: "CANCELLED" },
      ...getArchivedSourceOrderExclusion(),
      orderDate: { gte: dateRange.from, lte: dateRange.to },
      ...(city ? { destinationCity: city } : {}),
      ...(marketplace ? { marketplace } : {}),
    },
    include: {
      product: true,
      counterparty: true,
      items: { include: { product: true }, orderBy: { position: "asc" } },
    },
  });
}

async function getReceivedOrders(range: DateRange, city?: string, marketplace?: Marketplace) {
  return prisma.order.findMany({
    where: {
      status: "RECEIVED",
      isDeleted: false,
      ...getArchivedSourceOrderExclusion(),
      receivedAt: { gte: range.from, lte: range.to },
      ...(city ? { destinationCity: city } : {}),
      ...(marketplace ? { marketplace } : {}),
    },
    include: {
      product: true,
      counterparty: true,
      items: { include: { product: true }, orderBy: { position: "asc" } },
    },
  });
}

export async function getKpiForRange(range: DateRange, city?: string, marketplace?: Marketplace) {
  const orders = await getActiveOrders(range, city, marketplace);
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
    where: getReportReturnWhere(range, marketplace, city),
  });
  const receivedOrdersCount = await prisma.order.count({
    where: {
      status: "RECEIVED",
      isDeleted: false,
      ...getArchivedSourceOrderExclusion(),
      receivedAt: { gte: range.from, lte: range.to },
      ...(city ? { destinationCity: city } : {}),
      ...(marketplace ? { marketplace } : {}),
    },
  });

  return {
    ...totals,
    ordersCount: orders.length,
    receivedOrdersCount,
    avgCheck: Math.round(avgCheck * 100) / 100,
    returnsCount: returns,
    returnsPercent: receivedOrdersCount > 0 ? (returns / receivedOrdersCount) * 100 : 0,
  };
}

export async function getPnL(range: DateRange, marketplace?: Marketplace) {
  const dateRange = getDatabaseDateRange(range);
  const orders = await getReceivedOrders(range, undefined, marketplace);
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

  const expenses = marketplace ? [] : await prisma.expense.findMany({
    where: { date: { gte: dateRange.from, lte: dateRange.to } },
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

export async function getProductsReport(range: DateRange, marketplace?: Marketplace) {
  const orders = await getReceivedOrders(range, undefined, marketplace);
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

export async function getCounterpartiesReport(range: DateRange, marketplace?: Marketplace) {
  const dateRange = getDatabaseDateRange(range);
  const orders = await prisma.order.findMany({
    where: {
      isDeleted: false,
      status: { not: "CANCELLED" },
      ...getArchivedSourceOrderExclusion(),
      orderDate: { gte: dateRange.from, lte: dateRange.to },
      ...(marketplace ? { marketplace } : {}),
    },
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

export async function getReturnsReport(range: DateRange, marketplace?: Marketplace) {
  const [returns, receivedOrders] = await Promise.all([
    prisma.return.findMany({
      where: getReportReturnWhere(range, marketplace),
      include: { product: true },
    }),
    getReceivedOrders(range, undefined, marketplace),
  ]);

  const totalByProduct: Record<string, { name: string; returns: number }> = {};
  for (const r of returns) {
    if (!totalByProduct[r.productId]) {
      totalByProduct[r.productId] = { name: r.product.name, returns: 0 };
    }
    totalByProduct[r.productId].returns += 1;
  }

  const soldByProduct: Record<string, number> = {};
  for (const order of receivedOrders) {
    const items = order.items.length
      ? order.items
      : [{ productId: order.productId, quantity: order.quantity }];
    for (const item of items) {
      soldByProduct[item.productId] =
        (soldByProduct[item.productId] ?? 0) + item.quantity;
    }
  }

  return Object.entries(totalByProduct).map(([productId, d]) => {
    const sold = soldByProduct[productId] ?? 0;
    return {
      productId,
      name: d.name,
      returns: d.returns,
      returnPercent: sold > 0 ? (d.returns / sold) * 100 : 0,
    };
  });
}

export async function getOrderStatusCounts(range: DateRange, marketplace?: Marketplace) {
  const dateRange = getDatabaseDateRange(range);
  const counts = await prisma.order.groupBy({
    by: ["status"],
    where: {
      isDeleted: false,
      status: { not: "CANCELLED" },
      ...getArchivedSourceOrderExclusion(),
      orderDate: { gte: dateRange.from, lte: dateRange.to },
      ...(marketplace ? { marketplace } : {}),
    },
    _count: { _all: true },
  });
  const result: Record<string, number> = {};
  for (const c of counts) result[c.status] = c._count._all;
  return result;
}

export async function getExpenseCategoryTotals(range: DateRange) {
  const dateRange = getDatabaseDateRange(range);
  const expenses = await prisma.expense.findMany({
    where: { date: { gte: dateRange.from, lte: dateRange.to } },
    select: { category: true, amount: true },
  });
  const result: Record<string, number> = {};
  for (const e of expenses) {
    result[e.category] = (result[e.category] ?? 0) + toDecimalNumber(e.amount);
  }
  return result;
}

export async function getAvitoProfileCounts(range: DateRange, marketplace?: Marketplace) {
  if (marketplace === "WB") return [];
  const dateRange = getDatabaseDateRange(range);
  const orders = await prisma.order.groupBy({
    by: ["avitoProfileId"],
    where: {
      isDeleted: false,
      status: { not: "CANCELLED" },
      ...getArchivedSourceOrderExclusion(),
      orderDate: { gte: dateRange.from, lte: dateRange.to },
      marketplace: "AVITO",
    },
    _count: { _all: true },
  });
  const profiles = await prisma.avitoProfile.findMany({
    orderBy: { name: "asc" },
  });
  const names = new Map(profiles.map((profile) => [profile.id, profile.name]));
  return orders.map((item) => ({
    id: item.avitoProfileId ?? "NO_PROFILE",
    label: item.avitoProfileId ? names.get(item.avitoProfileId) ?? "Удалённый профиль" : "Не указан",
    count: item._count._all,
  }));
}

export async function getDynamicsChart(range: DateRange, marketplace?: Marketplace) {
  const [receivedOrders, activeOrders] = await Promise.all([
    getReceivedOrders(range, undefined, marketplace),
    getActiveOrders(range, undefined, marketplace),
  ]);
  const byDay: Record<string, { revenue: number; profit: number; orders: number }> = {};

  const ensureDay = (day: string) => {
    if (!byDay[day]) byDay[day] = { revenue: 0, profit: 0, orders: 0 };
    return byDay[day];
  };

  for (const order of activeOrders) {
    ensureDay(formatDateInput(order.orderDate)).orders += 1;
  }

  for (const o of receivedOrders) {
    const fin = calcOrderFinancials({
      salePriceAtOrder: toDecimalNumber(o.salePriceAtOrder),
      quantity: o.quantity,
      purchasePricePerUnit: toDecimalNumber(o.purchasePricePerUnit),
      logisticsCost: toDecimalNumber(o.logisticsCost),
      commissionCost: toDecimalNumber(o.commissionCost),
      otherCosts: toDecimalNumber(o.otherCosts),
    });
    const day = formatDateInput(o.receivedAt ?? o.orderDate);
    const bucket = ensureDay(day);
    bucket.revenue += fin.revenue;
    bucket.profit += fin.netProfit;
  }

  return Object.entries(byDay)
    .map(([date, d]) => ({ date, ...d }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

export async function getMarketplaceReport(range: DateRange) {
  const orders = await getActiveOrders(range);
  const summary = (["AVITO", "WB"] as const).map((marketplace) => {
    const selected = orders.filter((order) => order.marketplace === marketplace);
    const totals = sumFinancials(
      selected.map((order) =>
        calcOrderFinancials({
          salePriceAtOrder: toDecimalNumber(order.salePriceAtOrder),
          quantity: order.quantity,
          purchasePricePerUnit: toDecimalNumber(order.purchasePricePerUnit),
          logisticsCost: toDecimalNumber(order.logisticsCost),
          commissionCost: toDecimalNumber(order.commissionCost),
          otherCosts: toDecimalNumber(order.otherCosts),
        }),
      ),
    );
    return {
      marketplace,
      orders: selected.length,
      revenue: totals.revenue,
      profit: totals.netProfit,
    };
  });

  const dynamics: Record<
    string,
    { date: string; avitoOrders: number; wbOrders: number; avitoProfit: number; wbProfit: number }
  > = {};
  for (const order of orders) {
    const date = formatDateInput(order.orderDate);
    dynamics[date] ??= {
      date,
      avitoOrders: 0,
      wbOrders: 0,
      avitoProfit: 0,
      wbProfit: 0,
    };
    const financials = calcOrderFinancials({
      salePriceAtOrder: toDecimalNumber(order.salePriceAtOrder),
      quantity: order.quantity,
      purchasePricePerUnit: toDecimalNumber(order.purchasePricePerUnit),
      logisticsCost: toDecimalNumber(order.logisticsCost),
      commissionCost: toDecimalNumber(order.commissionCost),
      otherCosts: toDecimalNumber(order.otherCosts),
    });
    if (order.marketplace === "WB") {
      dynamics[date].wbOrders += 1;
      dynamics[date].wbProfit += financials.netProfit;
    } else {
      dynamics[date].avitoOrders += 1;
      dynamics[date].avitoProfit += financials.netProfit;
    }
  }

  return {
    summary,
    dynamics: Object.values(dynamics).sort((left, right) => left.date.localeCompare(right.date)),
  };
}
