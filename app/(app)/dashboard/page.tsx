import { prisma } from "@/lib/db/prisma";
import { calcOrderFinancials, sumFinancials } from "@/lib/finance/calculations";
import { toDecimalNumber } from "@/lib/db/orders";
import {
  endOfDatabaseDate,
  endOfDay,
  endOfMonth,
  formatRub,
  startOfDatabaseDate,
  startOfDay,
  startOfMonth,
  subDays,
} from "@/lib/utils";
import { ChevronRight, Package, Plus, RotateCcw, Search, Wallet } from "lucide-react";
import { ORDER_STATUS_LABELS, ORDER_STATUS_COLORS } from "@/lib/constants";
import Link from "next/link";
import Image from "next/image";
import { Card, CardContent } from "@/components/ui/card";
import { OrderStatus } from "@prisma/client";
import { buildTopProductsByOrders } from "@/lib/dashboard/top-products";
import { getArchivedSourceOrderExclusion } from "@/lib/orders/warehouse-match";
import { ThemeToggle } from "@/components/ui/theme-toggle";

export const dynamic = "force-dynamic";
export const revalidate = 0;

async function getDashboardData() {
  const now = new Date();
  const todayStart = startOfDay(now);
  const todayEnd = endOfDay(now);
  const weekStart = startOfDay(subDays(now, 6));
  const monthStart = startOfMonth(now);
  const monthEnd = endOfMonth(now);
  const monthDateStart = startOfDatabaseDate(monthStart);
  const monthDateEnd = endOfDatabaseDate(monthEnd);

  const [todayOrders, weekOrders, monthOrders, monthExpenses, lastOrders, topProducts, todayCreatedOrders, weekCreatedOrders] =
    await Promise.all([
      prisma.order.findMany({
        where: {
          status: "RECEIVED",
          receivedAt: { gte: todayStart, lte: todayEnd },
          isDeleted: false,
          ...getArchivedSourceOrderExclusion(),
        },
      }),
      prisma.order.findMany({
        where: {
          status: "RECEIVED",
          receivedAt: { gte: weekStart, lte: todayEnd },
          isDeleted: false,
          ...getArchivedSourceOrderExclusion(),
        },
      }),
      prisma.order.findMany({
        where: {
          status: "RECEIVED",
          receivedAt: { gte: monthStart, lte: monthEnd },
          isDeleted: false,
          ...getArchivedSourceOrderExclusion(),
        },
        include: { product: true },
      }),
      prisma.expense.findMany({
        where: { date: { gte: monthDateStart, lte: monthDateEnd } },
      }),
      prisma.order.findMany({
        where: { isDeleted: false },
        orderBy: { createdAt: "desc" },
        take: 10,
        include: {
          product: true,
          items: { include: { product: true }, orderBy: { position: "asc" } },
        },
      }),
      prisma.order.findMany({
        where: {
          isDeleted: false,
          status: { not: "CANCELLED" },
          ...getArchivedSourceOrderExclusion(),
        },
        include: {
          product: true,
          items: { include: { product: true }, orderBy: { position: "asc" } },
        },
      }),
      prisma.order.findMany({
        where: {
          isDeleted: false,
          status: { not: "CANCELLED" },
          ...getArchivedSourceOrderExclusion(),
          createdAt: { gte: todayStart, lte: todayEnd },
        },
      }),
      prisma.order.findMany({
        where: {
          isDeleted: false,
          status: { not: "CANCELLED" },
          ...getArchivedSourceOrderExclusion(),
          createdAt: { gte: weekStart, lte: todayEnd },
        },
      }),
    ]);

  const calc = (orders: typeof todayOrders) =>
    sumFinancials(orders.map((o) => calcOrderFinancials({
      salePriceAtOrder: toDecimalNumber(o.salePriceAtOrder),
      quantity: o.quantity,
      purchasePricePerUnit: toDecimalNumber(o.purchasePricePerUnit),
      logisticsCost: toDecimalNumber(o.logisticsCost),
      commissionCost: toDecimalNumber(o.commissionCost),
      otherCosts: toDecimalNumber(o.otherCosts),
    })));

  const todayFin = calc(todayOrders);
  const weekFin = calc(weekOrders);
  const todayOrdersFin = calc(todayCreatedOrders);
  const weekOrdersFin = calc(weekCreatedOrders);
  const monthFin = calc(monthOrders);
  const monthExpensesTotal = monthExpenses.reduce((s, e) => s + toDecimalNumber(e.amount), 0);

  const topProductsList = buildTopProductsByOrders(topProducts);

  return {
    todaySales: todayOrders.length,
    todayOrders: todayCreatedOrders.length,
    todayOrderAmount: todayOrdersFin.revenue,
    todayRevenue: todayFin.revenue,
    todayProfit: todayFin.netProfit,
    weekSales: weekOrders.length,
    weekOrders: weekCreatedOrders.length,
    weekOrderAmount: weekOrdersFin.revenue,
    weekProfit: weekFin.netProfit,
    monthRevenue: monthFin.revenue,
    monthExpenses: monthExpensesTotal,
    monthNetProfit: monthFin.netProfit - monthExpensesTotal,
    lastOrders,
    topProductsList,
  };
}

export default async function DashboardPage() {
  const data = await getDashboardData();

  const kpiCards = [
    { label: "Заказы сегодня", value: `${data.todayOrders}`, sub: formatRub(data.todayOrderAmount) },
    { label: "Получено сегодня", value: `${data.todaySales}`, sub: formatRub(data.todayRevenue) },
    { label: "Заказы за 7 дней", value: `${data.weekOrders}`, sub: formatRub(data.weekOrderAmount) },
    { label: "Получено за 7 дней", value: `${data.weekSales}`, sub: `${formatRub(data.weekProfit)} прибыли` },
  ];

  const formatOrderCount = (count: number) => {
    const lastTwo = count % 100;
    const last = count % 10;
    if (last === 1 && lastTwo !== 11) return `${count} заказ`;
    if (last >= 2 && last <= 4 && (lastTwo < 12 || lastTwo > 14)) {
      return `${count} заказа`;
    }
    return `${count} заказов`;
  };

  const quickActions = [
    { label: "Новый заказ", icon: Plus, href: "/orders?new=1" },
    { label: "Найти заказ", icon: Search, href: "/orders?search=1" },
    { label: "Возврат", icon: RotateCcw, href: "/orders?search=1" },
    { label: "Расход", icon: Wallet, href: "/expenses?new=1" },
  ];

  const getOrderImageUrl = (order: (typeof data.lastOrders)[number]) =>
    order.items.find((item) => item.imageUrls.length > 0)?.imageUrls[0] ??
    order.product.imageUrl ??
    order.items.find((item) => item.product.imageUrl)?.product.imageUrl ??
    null;

  return (
    <div className="app-shell">
      <div className="dashboard-content app-content space-y-5">
        <div className="mobile-only flex justify-end">
          <ThemeToggle />
        </div>
        <div className="pc-dashboard-kpi grid grid-cols-2 gap-3">
          {kpiCards.map((card, i) => (
            <Card key={card.label} className={i === 1 ? "border-primary/25 bg-accent/65" : undefined}>
              <CardContent className="p-3">
                <p className="text-[11px] font-semibold text-muted-foreground">{card.label}</p>
                <p className="mt-1 text-lg font-semibold tracking-tight tabular-nums">{card.value}</p>
                {card.sub && <p className="mt-0.5 text-xs font-medium text-muted-foreground">{card.sub}</p>}
              </CardContent>
            </Card>
          ))}
        </div>

        <div>
          <h2 className="section-title mb-3">Быстрые действия</h2>
          <div className="pc-quick-actions grid grid-cols-4 gap-2">
            {quickActions.map(({ label, icon: Icon, href }) => (
              <Link key={href} href={href} className="group flex flex-col items-center gap-2 rounded-md p-2 text-center transition-colors hover:bg-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 active:bg-accent">
                <div className="flex h-9 w-9 items-center justify-center rounded-md bg-secondary/80 text-foreground transition-colors group-hover:bg-primary/10 group-hover:text-primary">
                  <Icon className="h-4 w-4" />
                </div>
                <span className="text-[10px] font-semibold leading-tight text-muted-foreground">{label}</span>
              </Link>
            ))}
          </div>
        </div>

        <div className="pc-dashboard-main grid gap-5">
        <div>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="section-title">Последние заказы</h2>
            <Link href="/orders" className="flex items-center gap-0.5 text-xs font-semibold text-primary">
              Все заказы <ChevronRight className="h-3 w-3" />
            </Link>
          </div>
          <div className="overflow-hidden rounded-lg border border-border/75 bg-card">
            {data.lastOrders.map((order) => {
              const imageUrl = getOrderImageUrl(order);
              const fin = calcOrderFinancials({
                salePriceAtOrder: toDecimalNumber(order.salePriceAtOrder),
                quantity: order.quantity,
                purchasePricePerUnit: toDecimalNumber(order.purchasePricePerUnit),
                logisticsCost: toDecimalNumber(order.logisticsCost),
                commissionCost: toDecimalNumber(order.commissionCost),
                otherCosts: toDecimalNumber(order.otherCosts),
              });
              return (
                <Link key={order.id} href={`/orders/${order.id}`} className="block border-b border-border/70 transition-colors last:border-b-0 hover:bg-accent/55">
                  <div className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)_minmax(4.75rem,auto)] items-center gap-2 p-3 sm:gap-3">
                    <div className="h-11 w-11 shrink-0 overflow-hidden rounded-md bg-muted">
                      {imageUrl ? (
                        <Image src={imageUrl} alt={order.productNameSnapshot} width={44} height={44} unoptimized className="h-full w-full object-cover" />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center text-muted-foreground">
                          <Package className="h-5 w-5" />
                        </div>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold">{order.productNameSnapshot}</p>
                      <p className="truncate text-xs font-medium text-muted-foreground">{order.trackingNumber}</p>
                    </div>
                    <div className="min-w-0 space-y-1 text-right">
                      <p className="truncate text-sm font-semibold tabular-nums">{formatRub(fin.revenue)}</p>
                      <span className={`inline-block max-w-full truncate rounded-md px-1.5 py-0.5 text-[10px] font-semibold ${ORDER_STATUS_COLORS[order.status as OrderStatus]}`}>
                        {ORDER_STATUS_LABELS[order.status as OrderStatus]}
                      </span>
                    </div>
                  </div>
                </Link>
              );
            })}
            {data.lastOrders.length === 0 && (
              <p className="py-5 text-center text-sm font-medium text-muted-foreground">Заказов пока нет</p>
            )}
          </div>
        </div>

        <div>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="section-title">Топ товаров</h2>
            <Link href="/products" className="flex items-center gap-0.5 text-xs font-semibold text-primary">
              Все товары <ChevronRight className="h-3 w-3" />
            </Link>
          </div>
          <Card>
            <CardContent className="p-2">
              {data.topProductsList.map((p, i) => (
                <div key={p.id} className="grid min-w-0 grid-cols-[1.5rem_minmax(0,1fr)_minmax(4.5rem,auto)] items-center gap-2 rounded-md px-2 py-2">
                  <span className="flex h-6 w-6 items-center justify-center rounded-md bg-secondary text-xs font-semibold text-muted-foreground">{i + 1}</span>
                  <p className="min-w-0 flex-1 truncate text-sm font-medium">{p.name}</p>
                  <p className="min-w-0 truncate text-right text-sm font-semibold tabular-nums">
                    {formatOrderCount(p.orders)}
                  </p>
                </div>
              ))}
              {data.topProductsList.length === 0 && (
                <p className="py-3 text-center text-sm font-medium text-muted-foreground">Нет данных</p>
              )}
            </CardContent>
          </Card>
        </div>
        </div>

        <div>
          <h2 className="section-title mb-3">Финансы за месяц</h2>
          <div className="dashboard-finance-grid grid gap-3">
            {[
              { label: "Выручка", value: data.monthRevenue },
              { label: "Расходы", value: data.monthExpenses },
              { label: "Прибыль", value: data.monthNetProfit },
            ].map((item, i) => (
              <Card key={item.label} className={i === 2 ? "border-primary/25" : undefined}>
                <CardContent className="min-w-0 p-3.5">
                  <p className="text-[11px] font-semibold text-muted-foreground">{item.label}</p>
                  <p className="mt-1.5 min-w-0 break-words text-lg font-semibold leading-tight tabular-nums tracking-tight">{formatRub(item.value)}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
