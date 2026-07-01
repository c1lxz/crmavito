import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db/prisma";
import { calcOrderFinancials, sumFinancials } from "@/lib/finance/calculations";
import { toDecimalNumber } from "@/lib/db/orders";
import { formatRub, startOfDay, endOfDay, subDays, startOfMonth, endOfMonth } from "@/lib/utils";
import { ChevronRight, Package, Plus, RotateCcw, Search, Settings, Wallet } from "lucide-react";
import { ORDER_STATUS_LABELS, ORDER_STATUS_COLORS } from "@/lib/constants";
import Link from "next/link";
import Image from "next/image";
import { Card, CardContent } from "@/components/ui/card";
import { OrderStatus } from "@prisma/client";

async function getDashboardData() {
  const now = new Date();
  const todayStart = startOfDay(now);
  const todayEnd = endOfDay(now);
  const weekStart = startOfDay(subDays(now, 6));
  const monthStart = startOfMonth(now);
  const monthEnd = endOfMonth(now);

  const [todayOrders, weekOrders, monthOrders, monthExpenses, lastOrders, topProducts, todayCreatedOrders, weekCreatedOrders] =
    await Promise.all([
      prisma.order.findMany({
        where: { status: "RECEIVED", receivedAt: { gte: todayStart, lte: todayEnd }, isDeleted: false },
      }),
      prisma.order.findMany({
        where: { status: "RECEIVED", receivedAt: { gte: weekStart, lte: todayEnd }, isDeleted: false },
      }),
      prisma.order.findMany({
        where: { status: "RECEIVED", receivedAt: { gte: monthStart, lte: monthEnd }, isDeleted: false },
        include: { product: true },
      }),
      prisma.expense.findMany({
        where: { date: { gte: monthStart, lte: monthEnd } },
      }),
      prisma.order.findMany({
        where: { isDeleted: false },
        orderBy: { createdAt: "desc" },
        take: 10,
        include: { product: true },
      }),
      prisma.order.findMany({
        where: { status: "RECEIVED", isDeleted: false },
        include: {
          product: true,
          items: { include: { product: true }, orderBy: { position: "asc" } },
        },
      }),
      prisma.order.findMany({
        where: { isDeleted: false, orderDate: { gte: todayStart, lte: todayEnd } },
      }),
      prisma.order.findMany({
        where: { isDeleted: false, orderDate: { gte: weekStart, lte: todayEnd } },
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

  const productProfits: Record<string, { name: string; imageUrl: string | null; profit: number }> = {};
  for (const o of topProducts) {
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
      if (!productProfits[item.productId]) {
        productProfits[item.productId] = {
          name: item.productNameSnapshot,
          imageUrl: item.product.imageUrl,
          profit: 0,
        };
      }
      productProfits[item.productId].profit += revenue - cost - allocatedCosts;
    }
  }
  const topProductsList = Object.entries(productProfits)
    .map(([id, d]) => ({ id, ...d }))
    .sort((a, b) => b.profit - a.profit)
    .slice(0, 5);

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
  const [session, data] = await Promise.all([auth(), getDashboardData()]);
  const today = new Date().toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" });

  const kpiCards = [
    { label: "Заказы сегодня", value: `${data.todayOrders}`, sub: formatRub(data.todayOrderAmount) },
    { label: "Продажи сегодня", value: `${data.todaySales}`, sub: formatRub(data.todayRevenue) },
    { label: "Заказы за 7 дней", value: `${data.weekOrders}`, sub: formatRub(data.weekOrderAmount) },
    { label: "Продажи за 7 дней", value: `${data.weekSales}`, sub: `${formatRub(data.weekProfit)} прибыли` },
  ];

  const quickActions = [
    { label: "Новый заказ", icon: Plus, href: "/orders?new=1" },
    { label: "Найти заказ", icon: Search, href: "/orders?search=1" },
    { label: "Возврат", icon: RotateCcw, href: "/orders?search=1" },
    { label: "Расход", icon: Wallet, href: "/expenses?new=1" },
  ];

  return (
    <div className="app-shell">
      <div className="app-header">
        <div className="flex items-center justify-between">
          <div>
            <p className="section-caption">{today}</p>
            <h1 className="text-xl font-semibold tracking-tight">CRM Avito</h1>
            <span className="text-xs font-medium text-muted-foreground">
              Рабочая сводка для {session?.user?.name}
            </span>
          </div>
          <Link href="/settings" className="icon-tile hover:border-primary/35 hover:text-primary">
            <Settings className="h-5 w-5" />
          </Link>
        </div>
      </div>

      <div className="app-content space-y-5">
        <div className="grid grid-cols-2 gap-3">
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
          <div className="grid grid-cols-4 gap-2">
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

        <div>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="section-title">Последние заказы</h2>
            <Link href="/orders" className="flex items-center gap-0.5 text-xs font-semibold text-primary">
              Все заказы <ChevronRight className="h-3 w-3" />
            </Link>
          </div>
          <div className="overflow-hidden rounded-lg border border-border/75 bg-card">
            {data.lastOrders.map((order) => {
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
                  <div className="flex items-center gap-3 p-3">
                    <div className="h-11 w-11 shrink-0 overflow-hidden rounded-md bg-muted">
                      {order.product.imageUrl ? (
                        <Image src={order.product.imageUrl} alt={order.productNameSnapshot} width={44} height={44} className="h-full w-full object-cover" />
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
                    <div className="shrink-0 space-y-1 text-right">
                      <p className="text-sm font-semibold tabular-nums">{formatRub(fin.revenue)}</p>
                      <span className={`rounded-md px-1.5 py-0.5 text-[10px] font-semibold ${ORDER_STATUS_COLORS[order.status as OrderStatus]}`}>
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
                <div key={p.id} className="flex items-center gap-3 rounded-md px-2 py-2">
                  <span className="flex h-6 w-6 items-center justify-center rounded-md bg-secondary text-xs font-semibold text-muted-foreground">{i + 1}</span>
                  <p className="min-w-0 flex-1 truncate text-sm font-medium">{p.name}</p>
                  <p className="text-sm font-semibold tabular-nums money-positive">{formatRub(p.profit)}</p>
                </div>
              ))}
              {data.topProductsList.length === 0 && (
                <p className="py-3 text-center text-sm font-medium text-muted-foreground">Нет данных</p>
              )}
            </CardContent>
          </Card>
        </div>

        <div>
          <h2 className="section-title mb-3">Финансы за месяц</h2>
          <div className="grid grid-cols-3 gap-3">
            {[
              { label: "Выручка", value: data.monthRevenue },
              { label: "Расходы", value: data.monthExpenses },
              { label: "Прибыль", value: data.monthNetProfit },
            ].map((item, i) => (
              <Card key={item.label} className={i === 2 ? "border-primary/25" : undefined}>
                <CardContent className="p-3.5">
                  <p className="text-[11px] font-semibold text-muted-foreground">{item.label}</p>
                  <p className="mt-1.5 text-lg font-semibold leading-none tabular-nums tracking-tight">{formatRub(item.value)}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
