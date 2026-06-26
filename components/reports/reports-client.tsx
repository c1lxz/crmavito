"use client";

import { useState, useEffect } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatRub, formatPercent, subDays, startOfDay, endOfDay } from "@/lib/utils";
import { EXPENSE_CATEGORY_LABELS, EXPENSE_CATEGORY_COLORS, ORDER_STATUS_LABELS } from "@/lib/constants";
import { MetricCard } from "@/components/dashboard/MetricCard";
import { DynamicsChart, type Period } from "@/components/dashboard/DynamicsChart";
import { ExpensesDonut, type ExpenseItem } from "@/components/dashboard/ExpensesDonut";
import { OrdersStatusDonut, type OrderStatusItem } from "@/components/dashboard/OrdersStatusDonut";
import { TopProductsProfit } from "@/components/dashboard/TopProductsProfit";

interface KpiData {
  revenue: number; costOfGoods: number; grossProfit: number; marginPercent: number; netProfit: number;
  ordersCount: number; avgCheck: number; returnsCount: number; returnsPercent: number;
}

const ORDER_STATUS_HEX: Record<string, string> = {
  ACCEPTED: "#6366f1",
  SHIPPED: "#eab308",
  RECEIVED: "#22c55e",
  RETURNING: "#f97316",
  RETURNED: "#ef4444",
};

const EXPENSE_ORDER: string[] = [
  "PURCHASE", "LOGISTICS", "ADVERTISING", "AVITO_COMMISSION", "PACKAGING", "SALARY", "OTHER",
];

export function ReportsClient() {
  const now = new Date();
  const [dateFrom, setDateFrom] = useState(startOfDay(subDays(now, 29)).toISOString().slice(0, 10));
  const [dateTo, setDateTo] = useState(endOfDay(now).toISOString().slice(0, 10));
  const [kpi, setKpi] = useState<{ current: KpiData; prev: KpiData } | null>(null);
  const [pnl, setPnl] = useState<Record<string, number> | null>(null);
  const [products, setProducts] = useState<Array<{ productId: string; name: string; imageUrl: string | null; sold: number; revenue: number; profit: number }>>([]);
  const [dynamics, setDynamics] = useState<Array<{ date: string; revenue: number; profit: number }>>([]);
  const [orderStatuses, setOrderStatuses] = useState<Record<string, number>>({});
  const [expenseCategories, setExpenseCategories] = useState<Record<string, number>>({});
  const [period, setPeriod] = useState<Period>("day");
  const [loading, setLoading] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const params = `dateFrom=${dateFrom}&dateTo=${dateTo}`;
      const [kpiRes, pnlRes, prodRes, dynRes, statusRes, expCatRes] = await Promise.all([
        fetch(`/api/reports?type=kpi&${params}`).then((r) => r.json()),
        fetch(`/api/reports?type=pnl&${params}`).then((r) => r.json()),
        fetch(`/api/reports?type=products&${params}`).then((r) => r.json()),
        fetch(`/api/reports?type=dynamics&${params}`).then((r) => r.json()),
        fetch(`/api/reports?type=order-statuses&${params}`).then((r) => r.json()),
        fetch(`/api/reports?type=expense-categories&${params}`).then((r) => r.json()),
      ]);
      setKpi(kpiRes);
      setPnl(pnlRes);
      setProducts(prodRes);
      setDynamics(dynRes);
      setOrderStatuses(statusRes);
      setExpenseCategories(expCatRes);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [dateFrom, dateTo]);

  const expenseDonutData: ExpenseItem[] = EXPENSE_ORDER.map((key) => ({
    key,
    label: EXPENSE_CATEGORY_LABELS[key as keyof typeof EXPENSE_CATEGORY_LABELS] ?? key,
    amount: expenseCategories[key] ?? 0,
    color: EXPENSE_CATEGORY_COLORS[key as keyof typeof EXPENSE_CATEGORY_COLORS] ?? "#888",
  }));
  const expenseTotal = expenseDonutData.reduce((s, d) => s + d.amount, 0);

  const orderStatusData: OrderStatusItem[] = Object.entries(ORDER_STATUS_LABELS).map(([status, label]) => ({
    status,
    label,
    count: orderStatuses[status] ?? 0,
    color: ORDER_STATUS_HEX[status] ?? "#888",
  }));
  const orderTotal = orderStatusData.reduce((s, d) => s + d.count, 0);

  return (
    <div className="bg-background min-h-screen">
      {/* Header */}
      <div className="sticky top-0 z-30 bg-background/95 backdrop-blur-sm border-b px-4 pt-[var(--app-top-pad)] pb-3">
        <div className="flex items-center justify-between mb-3">
          <h1 className="text-xl font-bold">Отчёты</h1>
          <Button size="sm" variant="outline" onClick={load} disabled={loading}>
            {loading ? "..." : "Обновить"}
          </Button>
        </div>
        <div className="flex gap-2 items-center">
          <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="text-sm" />
          <span className="text-muted-foreground">—</span>
          <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="text-sm" />
        </div>
      </div>

      <div className="px-4 py-3">
        <Tabs defaultValue="dashboard">
          <TabsList className="w-full grid grid-cols-5 mb-4">
            <TabsTrigger value="dashboard" className="text-xs">Дашборд</TabsTrigger>
            <TabsTrigger value="pnl" className="text-xs">P&L</TabsTrigger>
            <TabsTrigger value="products" className="text-xs">Товары</TabsTrigger>
            <TabsTrigger value="counterparties" className="text-xs">Поставщики</TabsTrigger>
            <TabsTrigger value="returns" className="text-xs">Возвраты</TabsTrigger>
          </TabsList>

          {/* ─── DASHBOARD TAB ─── */}
          <TabsContent value="dashboard" className="space-y-4">
            {/* MetricCards */}
            {kpi && (
              <div className="grid grid-cols-2 gap-3">
                <MetricCard label="Выручка" value={kpi.current.revenue} prevValue={kpi.prev.revenue} />
                <MetricCard label="Прибыль" value={kpi.current.netProfit} prevValue={kpi.prev.netProfit} />
                <MetricCard label="Заказов" value={kpi.current.ordersCount} prevValue={kpi.prev.ordersCount} format={(v) => String(v)} />
                <MetricCard label="Средний чек" value={kpi.current.avgCheck} prevValue={kpi.prev.avgCheck} />
                <MetricCard label="Возвраты" value={kpi.current.returnsCount} prevValue={kpi.prev.returnsCount} format={(v) => `${v} шт.`} />
                <MetricCard label="Маржа" value={kpi.current.marginPercent} prevValue={kpi.prev.marginPercent} format={formatPercent} />
              </div>
            )}

            {/* Dynamics */}
            <DynamicsChart data={dynamics} period={period} onPeriodChange={setPeriod} />

            {/* Donuts */}
            <ExpensesDonut data={expenseDonutData} total={expenseTotal} />
            <OrdersStatusDonut data={orderStatusData} total={orderTotal} />

            {/* Top products */}
            <TopProductsProfit products={products.slice(0, 5)} />
          </TabsContent>

          {/* ─── P&L TAB ─── */}
          <TabsContent value="pnl">
            {pnl ? (
              <Card>
                <CardHeader className="p-4 pb-2"><CardTitle>P&L за период</CardTitle></CardHeader>
                <CardContent className="p-4 pt-0">
                  <div className="space-y-2">
                    {[
                      { label: "Выручка", value: pnl.revenue, sign: 1 },
                      { label: "− Себестоимость", value: pnl.costOfGoods, sign: -1 },
                      { label: "− Логистика", value: pnl.logistics, sign: -1 },
                      { label: "− Комиссии Avito", value: pnl.commission, sign: -1 },
                      { label: "− Реклама", value: pnl.advertising, sign: -1 },
                      { label: "− Прочие расходы", value: pnl.otherExpenses, sign: -1 },
                    ].map(({ label, value, sign }) => (
                      <div key={label} className="flex justify-between py-1 border-b last:border-0">
                        <span className="text-sm">{label}</span>
                        <span className={`text-sm font-medium ${sign < 0 ? "text-red-600" : ""}`}>{formatRub(value ?? 0)}</span>
                      </div>
                    ))}
                    <div className="flex justify-between pt-2 border-t-2">
                      <span className="font-bold">= Чистая прибыль</span>
                      <span className={`font-bold ${(pnl.netProfit ?? 0) >= 0 ? "text-emerald-600" : "text-red-600"}`}>{formatRub(pnl.netProfit ?? 0)}</span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ) : <p className="text-center text-muted-foreground py-8">Загрузка...</p>}
          </TabsContent>

          {/* ─── PRODUCTS TAB ─── */}
          <TabsContent value="products">
            <div className="space-y-2">
              {products.map((p) => (
                <Card key={p.productId}>
                  <CardContent className="p-3">
                    <div className="flex items-center justify-between">
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-sm truncate">{p.name}</p>
                        <p className="text-xs text-muted-foreground">Продано: {p.sold} шт. · Выручка: {formatRub(p.revenue)}</p>
                      </div>
                      <p className="text-sm font-bold text-emerald-600 dark:text-emerald-400 ml-2">{formatRub(p.profit)}</p>
                    </div>
                  </CardContent>
                </Card>
              ))}
              {products.length === 0 && <p className="text-center text-muted-foreground py-8">Нет данных за период</p>}
            </div>
          </TabsContent>

          <TabsContent value="counterparties">
            <p className="text-center text-muted-foreground py-8">Выберите период и нажмите «Обновить»</p>
          </TabsContent>

          <TabsContent value="returns">
            <p className="text-center text-muted-foreground py-8">Выберите период и нажмите «Обновить»</p>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
