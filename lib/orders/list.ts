import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { calcOrderFinancials } from "@/lib/finance/calculations";
import { toDecimalNumber } from "@/lib/db/orders";

export const ORDER_LIST_PAGE_SIZE = 100;

export type OrderListFilters = {
  q?: string;
  status?: string;
  tracking?: string;
  counterpartyId?: string;
  avitoProfileId?: string;
  marketplace?: string;
  productId?: string;
  warehouseOnly?: boolean;
  dateFrom?: Date;
  dateTo?: Date;
};

export function buildOrderListWhere(filters: OrderListFilters): Prisma.OrderWhereInput {
  const where: Prisma.OrderWhereInput = { isDeleted: false };
  const and: Prisma.OrderWhereInput[] = [];

  if (filters.status) where.status = filters.status as Prisma.EnumOrderStatusFilter["equals"];
  if (filters.counterpartyId) where.counterpartyId = filters.counterpartyId;
  if (filters.avitoProfileId) where.avitoProfileId = filters.avitoProfileId;
  if (filters.marketplace) where.marketplace = filters.marketplace as Prisma.EnumMarketplaceFilter["equals"];
  if (filters.tracking) {
    and.push({ trackingNumber: { contains: filters.tracking, mode: "insensitive" } });
  }
  if (filters.q?.trim()) {
    const q = filters.q.trim();
    and.push({
      OR: [
        { productNameSnapshot: { contains: q, mode: "insensitive" } },
        { trackingNumber: { contains: q, mode: "insensitive" } },
        { orderNumber: { contains: q, mode: "insensitive" } },
      ],
    });
  }
  if (filters.productId) {
    and.push({ OR: [{ productId: filters.productId }, { items: { some: { productId: filters.productId } } }] });
  }
  if (filters.warehouseOnly) {
    and.push({ status: "ACCEPTED", items: { some: { sourceReturnId: { not: null } } } });
  }
  if (filters.dateFrom || filters.dateTo) {
    where.orderDate = {
      ...(filters.dateFrom ? { gte: filters.dateFrom } : {}),
      ...(filters.dateTo ? { lte: filters.dateTo } : {}),
    };
  }
  if (and.length) where.AND = and;
  return where;
}

const orderListSelect = {
  id: true,
  orderNumber: true,
  productId: true,
  productNameSnapshot: true,
  variant: true,
  size: true,
  trackingNumber: true,
  quantity: true,
  status: true,
  marketplace: true,
  orderDate: true,
  destinationCity: true,
  salePriceAtOrder: true,
  purchasePricePerUnit: true,
  logisticsCost: true,
  commissionCost: true,
  otherCosts: true,
  product: { select: { imageUrl: true } },
  counterparty: { select: { id: true, name: true } },
  avitoProfile: { select: { id: true, name: true, color: true, isActive: true } },
  items: {
    select: {
      imageUrls: true,
      sourceReturnId: true,
      productId: true,
      productNameSnapshot: true,
      variant: true,
      size: true,
      product: { select: { imageUrl: true } },
    },
    orderBy: { position: "asc" as const },
  },
} satisfies Prisma.OrderSelect;

type SelectedOrder = Prisma.OrderGetPayload<{ select: typeof orderListSelect }>;

export function serializeOrderListItem(order: SelectedOrder) {
  const inputs = {
    salePriceAtOrder: toDecimalNumber(order.salePriceAtOrder),
    quantity: order.quantity,
    purchasePricePerUnit: toDecimalNumber(order.purchasePricePerUnit),
    logisticsCost: toDecimalNumber(order.logisticsCost),
    commissionCost: toDecimalNumber(order.commissionCost),
    otherCosts: toDecimalNumber(order.otherCosts),
  };
  return {
    ...order,
    orderDate: order.orderDate.toISOString(),
    ...inputs,
    ...calcOrderFinancials(inputs),
  };
}

export async function getOrderList(
  filters: OrderListFilters,
  page = 1,
  pageSize = ORDER_LIST_PAGE_SIZE,
) {
  const where = buildOrderListWhere(filters);
  const safePage = Math.max(1, page);
  const safePageSize = Math.min(ORDER_LIST_PAGE_SIZE, Math.max(1, pageSize));
  const [orders, total, receivedOrders] = await Promise.all([
    prisma.order.findMany({
      where,
      select: orderListSelect,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (safePage - 1) * safePageSize,
      take: safePageSize,
    }),
    prisma.order.count({ where }),
    prisma.order.findMany({
      where: { AND: [where, { status: "RECEIVED" }] },
      select: {
        salePriceAtOrder: true,
        quantity: true,
        purchasePricePerUnit: true,
        logisticsCost: true,
        commissionCost: true,
        otherCosts: true,
      },
    }),
  ]);

  const summary = receivedOrders.reduce(
    (result, order) => {
      const financials = calcOrderFinancials({
        salePriceAtOrder: toDecimalNumber(order.salePriceAtOrder),
        quantity: order.quantity,
        purchasePricePerUnit: toDecimalNumber(order.purchasePricePerUnit),
        logisticsCost: toDecimalNumber(order.logisticsCost),
        commissionCost: toDecimalNumber(order.commissionCost),
        otherCosts: toDecimalNumber(order.otherCosts),
      });
      result.revenue += financials.revenue;
      result.profit += financials.netProfit;
      return result;
    },
    { revenue: 0, profit: 0 },
  );

  return {
    orders: orders.map(serializeOrderListItem),
    total,
    page: safePage,
    pageSize: safePageSize,
    summary,
  };
}
