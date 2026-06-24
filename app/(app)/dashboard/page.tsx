import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db/prisma";
import { calcOrderFinancials, sumFinancials } from "@/lib/finance/calculations";
import { toDecimalNumber } from "@/lib/db/orders";
import { formatRub, startOfDay, endOfDay, subDays, startOfMonth, endOfMonth } from "@/lib/utils";
import { Plus, Search, RotateCcw, Wallet, ChevronRight, Settings, ShoppingBag, TrendingUp, CalendarDays, Banknote, TrendingDown, DollarSign } from "lucide-react";
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

  const [todayOrders, weekOrders, monthOrders, monthExpenses, lastOrders, topProducts] =
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
        include: { product: true },
      }),
    ]);

  const calc = (orders: typeof todayOrders) =>
    sumFinancials(orders.map((o) => calcOrderFinancials({
      salePriceAtOrder: toDecimalNumber(o.salePriceAtOrder),
      quantity: o.quantity, purchasePricePerUnit: toDecimalNumber(o.purchasePricePerUnit),
      logisticsCost: toDecimalNumber(o.logisticsCost), commissionCost: toDecimalNumber(o.commissionCost),
      otherCosts: toDecimalNumber(o.otherCosts),
    })));

  const todayFin = calc(todayOrders);
  const weekFin = calc(weekOrders);
  const monthFin = calc(monthOrders);
  const monthExpensesTotal = monthExpenses.reduce((s, e) => s + toDecimalNumber(e.amount), 0);

  const productProfits: Record<string, { name: string; imageUrl: string | null; profit: number }> = {};
  for (const o of topProducts) {
    const fin = calcOrderFinancials({
      salePriceAtOrder: toDecimalNumber(o.salePriceAtOrder),
      quantity: o.quantity, purchasePricePerUnit: toDecimalNumber(o.purchasePricePerUnit),
      logisticsCost: toDecimalNumber(o.logisticsCost), commissionCost: toDecimalNumber(o.commissionCost),
      otherCosts: toDecimalNumber(o.otherCosts),
    });
    if (!productProfits[o.productId]) {
      productProfits[o.productId] = { name: o.productNameSnapshot, imageUrl: o.product.imageUrl, profit: 0 };
    }
    productProfits[o.productId].profit += fin.netProfit;
  }
  const topProductsList = Object.entries(productProfits)
    .map(([id, d]) => ({ id, ...d }))
    .sort((a, b) => b.profit - a.profit)
    .slice(0, 5);

  return {
    todaySales: todayOrders.length, todayRevenue: todayFin.revenue, todayProfit: todayFin.netProfit,
    weekSales: weekOrders.length, weekProfit: weekFin.netProfit,
    monthRevenue: monthFin.revenue, monthExpenses: monthExpensesTotal, monthNetProfit: monthFin.netProfit,
    lastOrders, topProductsList,
  };
}

export default async function DashboardPage() {
  const [session, data] = await Promise.all([auth(), getDashboardData()]);
  const today = new Date().toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" });

  const kpiCards = [
    { label: "Продажи сегодня", value: `${data.todaySales} заказов`, sub: formatRub(data.todayRevenue), color: "bg-indigo-500", blob: "bg-indigo-400", Icon: ShoppingBag },
    { label: "Прибыль сегодня", value: formatRub(data.todayProfit), sub: "чистая", color: "bg-emerald-500", blob: "bg-emerald-400", Icon: TrendingUp },
    { label: "Продажи за неделю", value: `${data.weekSales} заказов`, sub: null, color: "bg-amber-500", blob: "bg-amber-400", Icon: CalendarDays },
    { label: "Прибыль за неделю", value: formatRub(data.weekProfit), sub: "чистая", color: "bg-violet-500", blob: "bg-violet-400", Icon: Banknote },
  ];

  const quickActions = [
    { label: "Новый заказ", icon: Plus, href: "/orders?new=1", color: "bg-indigo-500" },
    { label: "Найти заказ", icon: Search, href: "/orders?search=1", color: "bg-blue-500" },
    { label: "Возврат", icon: RotateCcw, href: "/returns?new=1", color: "bg-emerald-500" },
    { label: "Расход", icon: Wallet, href: "/expenses?new=1", color: "bg-amber-500" },
  ];

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Header */}
      <div className="sticky top-0 z-30 bg-background/95 backdrop-blur-sm border-b px-4 pt-12 pb-4">
        <div className="flex items-center justify-between mb-1">
          <div>
            <h1 className="text-xl font-bold">CRM Avito</h1>
            <span className="text-xs text-muted-foreground">Привет, {session?.user?.name}</span>
          </div>
          <Link href="/settings" className="p-2 rounded-xl bg-card border border-border text-muted-foreground hover:text-foreground transition-colors">
            <Settings className="h-5 w-5" />
          </Link>
        </div>
        <div className="text-sm text-muted-foreground">{today}</div>
      </div>

      <div className="px-4 space-y-5 pb-4 pt-4">
        {/* KPI Cards */}
        <div className="grid grid-cols-2 gap-3">
          {kpiCards.map((card) => (
            <Card key={card.label} className="overflow-hidden relative">
              <CardContent className="p-4">
                <div className={`w-9 h-9 rounded-xl ${card.color} flex items-center justify-center mb-3 shadow-sm`}>
                  <card.Icon className="h-4 w-4 text-white" />
                </div>
                <p className="text-xs text-muted-foreground mb-0.5">{card.label}</p>
                <p className="text-base font-bold leading-tight">{card.value}</p>
                {card.sub && <p className="text-xs text-muted-foreground mt-0.5">{card.sub}</p>}
              </CardContent>
              <div className={`absolute -right-5 -bottom-5 w-20 h-20 rounded-full ${card.blob} opacity-[0.12] pointer-events-none`} />
            </Card>
          ))}
        </div>

        {/* Quick Actions */}
        <div>
          <h2 className="text-sm font-semibold text-muted-foreground mb-3">Быстрые действия</h2>
          <div className="grid grid-cols-4 gap-2">
            {quickActions.map(({ label, icon: Icon, href, color }) => (
              <Link key={href} href={href} className="flex flex-col items-center gap-2">
                <div className={`${color} w-12 h-12 rounded-2xl flex items-center justify-center shadow-lg`}>
                  <Icon className="h-5 w-5 text-white" />
                </div>
                <span className="text-[10px] text-muted-foreground text-center leading-tight">{label}</span>
              </Link>
            ))}
          </div>
        </div>

        {/* Last Orders */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold">Последние заказы</h2>
            <Link href="/orders" className="text-xs text-primary flex items-center gap-0.5">
              Все заказы <ChevronRight className="h-3 w-3" />
            </Link>
          </div>
          <div className="space-y-2">
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
                <Link key={order.id} href={`/orders/${order.id}`}>
                  <Card className="hover:bg-accent transition-colors">
                    <CardContent className="p-3 flex items-center gap-3">
                      <div className="w-10 h-10 rounded-lg bg-muted overflow-hidden flex-shrink-0">
                        {order.product.imageUrl ? (
                          <Image src={order.product.imageUrl} alt={order.productNameSnapshot} width={40} height={40} className="object-cover w-full h-full" />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-muted-foreground text-xs">📦</div>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{order.productNameSnapshot}</p>
                        <p className="text-xs text-muted-foreground truncate">{order.trackingNumber}</p>
                      </div>
                      <div className="text-right flex-shrink-0">
                        <p className="text-sm font-semibold">{formatRub(fin.revenue)}</p>
                        <span className={`text-xs px-1.5 py-0.5 rounded-full ${ORDER_STATUS_COLORS[order.status as OrderStatus]}`}>
                          {ORDER_STATUS_LABELS[order.status as OrderStatus]}
                        </span>
                      </div>
                    </CardContent>
                  </Card>
                </Link>
              );
            })}
            {data.lastOrders.length === 0 && (
              <p className="text-muted-foreground text-sm text-center py-4">Заказов пока нет</p>
            )}
          </div>
        </div>

        {/* Top Products */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold">Топ товаров</h2>
            <Link href="/products" className="text-xs text-primary flex items-center gap-0.5">
              Все товары <ChevronRight className="h-3 w-3" />
            </Link>
          </div>
          <Card>
            <CardContent className="p-3 space-y-3">
              {data.topProductsList.map((p, i) => (
                <div key={p.id} className="flex items-center gap-3">
                  <span className="text-muted-foreground text-sm w-4 text-center font-medium">{i + 1}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm truncate">{p.name}</p>
                  </div>
                  <p className="text-sm font-semibold text-emerald-600 dark:text-emerald-400">{formatRub(p.profit)}</p>
                </div>
              ))}
              {data.topProductsList.length === 0 && (
                <p className="text-muted-foreground text-sm text-center py-2">Нет данных</p>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Finances month */}
        <div>
          <h2 className="text-sm font-semibold mb-3">Финансы за месяц</h2>
          <div className="grid grid-cols-3 gap-3">
            {[
              { label: "Выручка", value: data.monthRevenue, textColor: "text-indigo-600 dark:text-indigo-400", iconBg: "bg-indigo-500", Icon: TrendingUp },
              { label: "Расходы", value: data.monthExpenses, textColor: "text-rose-600 dark:text-rose-400", iconBg: "bg-rose-500", Icon: TrendingDown },
              { label: "Прибыль", value: data.monthNetProfit, textColor: "text-emerald-600 dark:text-emerald-400", iconBg: "bg-emerald-500", Icon: DollarSign },
            ].map((item) => (
              <Card key={item.label} className="overflow-hidden">
                <CardContent className="p-3 text-center">
                  <div className={`w-7 h-7 rounded-lg ${item.iconBg} flex items-center justify-center mx-auto mb-2`}>
                    <item.Icon className="h-3.5 w-3.5 text-white" />
                  </div>
                  <p className="text-[10px] text-muted-foreground mb-1">{item.label}</p>
                  <p className={`text-xs font-bold ${item.textColor}`}>{formatRub(item.value)}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
