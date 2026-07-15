"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDateInput, formatRub, formatPercent, startOfMonth } from "@/lib/utils";
import { EXPENSE_CATEGORY_LABELS, EXPENSE_CATEGORY_COLORS } from "@/lib/constants";
import { MetricCard } from "@/components/dashboard/MetricCard";
import { OrdersDynamicsChart, type Period } from "@/components/dashboard/DynamicsChart";
import { ExpensesDonut, type ExpenseItem } from "@/components/dashboard/ExpensesDonut";
import { OrdersStatusDonut, type OrderStatusItem } from "@/components/dashboard/OrdersStatusDonut";
import { TopProductsProfit } from "@/components/dashboard/TopProductsProfit";
import {
  MOSCOW_DAY_CHANGED_EVENT,
  type MoscowDayChangedDetail,
} from "@/lib/time/moscow-day";

interface KpiData {
  revenue: number; costOfGoods: number; grossProfit: number; marginPercent: number; netProfit: number;
  ordersCount: number; avgCheck: number; returnsCount: number; returnsPercent: number;
}

const AVITO_PROFILE_COLORS = ["#6366f1", "#22c55e", "#eab308", "#f97316", "#7c3aed", "#06b6d4", "#ef4444"];

const EXPENSE_ORDER: string[] = [
  "PURCHASE", "LOGISTICS", "ADVERTISING", "AVITO_COMMISSION", "PACKAGING", "SALARY", "OTHER",
];

export function ReportsClient() {
  const [dateFrom, setDateFrom] = useState(() => formatDateInput(startOfMonth(new Date())));
  const [dateTo, setDateTo] = useState(() => formatDateInput());
  const [kpi, setKpi] = useState<{ current: KpiData; prev: KpiData } | null>(null);
  const [pnl, setPnl] = useState<Record<string, number> | null>(null);
  const [products, setProducts] = useState<Array<{ productId: string; name: string; imageUrl: string | null; sold: number; revenue: number; profit: number }>>([]);
  const [counterparties, setCounterparties] = useState<Array<{ counterpartyId: string; name: string; purchased: number; revenue: number; profit: number }>>([]);
  const [returns, setReturns] = useState<Array<{ productId: string; name: string; returns: number; returnPercent: number }>>([]);
  const [dynamics, setDynamics] = useState<Array<{ date: string; revenue: number; profit: number; orders: number }>>([]);
  const [avitoProfiles, setAvitoProfiles] = useState<Array<{ id: string; label: string; count: number }>>([]);
  const [expenseCategories, setExpenseCategories] = useState<Record<string, number>>({});
  const [period, setPeriod] = useState<Period>("day");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestIdRef = useRef(0);

  const load = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    setLoading(true);
    setError(null);
    try {
      const params = `dateFrom=${dateFrom}&dateTo=${dateTo}`;
      const fetchReport = async <T,>(type: string): Promise<T> => {
        const response = await fetch(`/api/reports?type=${type}&${params}`, {
          cache: "no-store",
        });
        const body = await response.json().catch(() => null);
        if (!response.ok) {
          throw new Error(
            typeof body?.error === "string" ? body.error : `Ошибка загрузки отчёта (${response.status})`,
          );
        }
        return body as T;
      };
      const [kpiRes, pnlRes, prodRes, cpRes, returnsRes, dynRes, avitoProfilesRes, expCatRes] = await Promise.all([
        fetchReport<{ current: KpiData; prev: KpiData }>("kpi"),
        fetchReport<Record<string, number>>("pnl"),
        fetchReport<typeof products>("products"),
        fetchReport<typeof counterparties>("counterparties"),
        fetchReport<typeof returns>("returns"),
        fetchReport<typeof dynamics>("dynamics"),
        fetchReport<Array<{ id: string; label: string; count: number }>>("avito-profiles"),
        fetchReport<Record<string, number>>("expense-categories"),
      ]);
      if (requestId !== requestIdRef.current) return;
      setKpi(kpiRes);
      setPnl(pnlRes);
      setProducts(prodRes);
      setCounterparties(cpRes);
      setReturns(returnsRes);
      setDynamics(dynRes);
      setAvitoProfiles(avitoProfilesRes);
      setExpenseCategories(expCatRes);
    } catch (loadError) {
      if (requestId === requestIdRef.current) {
        setError(loadError instanceof Error ? loadError.message : "Не удалось загрузить отчёты");
      }
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
  }, [dateFrom, dateTo]);

  useEffect(() => {
    void load();
    const intervalId = window.setInterval(() => void load(), 60_000);
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") void load();
    };
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [load]);

  useEffect(() => {
    const handleMoscowDayChanged = (event: Event) => {
      const detail = (event as CustomEvent<MoscowDayChangedDetail>).detail;
      setDateTo(detail.currentDay);
      setDateFrom((current) => {
        const previousMonthStart = `${detail.previousDay.slice(0, 7)}-01`;
        return current === previousMonthStart
          ? `${detail.currentDay.slice(0, 7)}-01`
          : current;
      });
    };
    window.addEventListener(MOSCOW_DAY_CHANGED_EVENT, handleMoscowDayChanged);
    return () => {
      window.removeEventListener(MOSCOW_DAY_CHANGED_EVENT, handleMoscowDayChanged);
    };
  }, []);

  const expenseDonutData: ExpenseItem[] = EXPENSE_ORDER.map((key) => ({
    key,
    label: EXPENSE_CATEGORY_LABELS[key as keyof typeof EXPENSE_CATEGORY_LABELS] ?? key,
    amount: expenseCategories[key] ?? 0,
    color: EXPENSE_CATEGORY_COLORS[key as keyof typeof EXPENSE_CATEGORY_COLORS] ?? "#888",
  }));
  const expenseTotal = expenseDonutData.reduce((s, d) => s + d.amount, 0);

  const ordersReturnsData: OrderStatusItem[] = kpi
    ? [
        {
          status: "orders",
          label: "Заказы",
          count: kpi.current.ordersCount,
          color: "#6366f1",
        },
        {
          status: "returns",
          label: "Возвраты",
          count: kpi.current.returnsCount,
          color: "#ef4444",
        },
      ]
    : [];
  const ordersReturnsTotal = ordersReturnsData.reduce((s, d) => s + d.count, 0);
  const returnsRatio = kpi?.current.returnsPercent ?? 0;
  const avitoProfileData: OrderStatusItem[] = avitoProfiles.map((profile, index) => ({
    status: profile.id,
    label: profile.label,
    count: profile.count,
    color: AVITO_PROFILE_COLORS[index % AVITO_PROFILE_COLORS.length],
  }));
  const avitoProfileTotal = avitoProfileData.reduce((s, d) => s + d.count, 0);

  return (
    <div className="app-shell">
      <div className="app-header">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Отчёты</h1>
            <p className="section-caption">Деньги, маржа и структура заказов</p>
          </div>
          <Button size="sm" variant="outline" onClick={() => void load()} disabled={loading}>
            {loading ? "..." : "Обновить"}
          </Button>
        </div>
        <div className="flex gap-2 items-center">
          <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="text-sm" />
          <span className="text-muted-foreground">—</span>
          <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="text-sm" />
        </div>
      </div>

      <div className="app-content">
        {error && (
          <div role="alert" className="mb-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </div>
        )}
        <Tabs defaultValue="dashboard">
          <TabsList className="w-full grid grid-cols-5 mb-4 overflow-hidden">
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
                <MetricCard label="Сумма заказов" value={kpi.current.revenue} prevValue={kpi.prev.revenue} />
                <MetricCard label="Прибыль заказов" value={kpi.current.netProfit} prevValue={kpi.prev.netProfit} />
                <MetricCard label="Заказов" value={kpi.current.ordersCount} prevValue={kpi.prev.ordersCount} format={(v) => String(v)} />
                <MetricCard label="Средний чек" value={kpi.current.avgCheck} prevValue={kpi.prev.avgCheck} />
                <MetricCard label="Возвраты" value={kpi.current.returnsCount} prevValue={kpi.prev.returnsCount} format={(v) => `${v} шт.`} />
                <MetricCard label="Маржа" value={kpi.current.marginPercent} prevValue={kpi.prev.marginPercent} format={formatPercent} />
              </div>
            )}

            {/* Dynamics */}
            <OrdersDynamicsChart data={dynamics} period={period} onPeriodChange={setPeriod} />

            {/* Donuts */}
            <ExpensesDonut data={expenseDonutData} total={expenseTotal} />
            <OrdersStatusDonut
              title="Заказы / возвраты"
              data={ordersReturnsData}
              total={ordersReturnsTotal}
              centerValue={formatPercent(returnsRatio)}
              centerLabel="Возвраты"
            />
            <OrdersStatusDonut title="Заказы по профилям Avito" data={avitoProfileData} total={avitoProfileTotal} />

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
                      <div key={label} className="flex justify-between py-1.5 border-b border-border/70 last:border-0">
                        <span className="text-sm">{label}</span>
                        <span className={`text-sm font-medium tabular-nums ${sign < 0 ? "money-negative" : ""}`}>{formatRub(value ?? 0)}</span>
                      </div>
                    ))}
                    <div className="flex justify-between pt-2 border-t-2">
                      <span className="font-bold">= Чистая прибыль</span>
                      <span className={`font-bold tabular-nums ${(pnl.netProfit ?? 0) >= 0 ? "money-positive" : "money-negative"}`}>{formatRub(pnl.netProfit ?? 0)}</span>
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
                  <p className="text-sm font-bold tabular-nums money-positive ml-2">{formatRub(p.profit)}</p>
                    </div>
                  </CardContent>
                </Card>
              ))}
              {products.length === 0 && <p className="text-center text-muted-foreground py-8">Нет данных за период</p>}
            </div>
          </TabsContent>

          <TabsContent value="counterparties">
            <div className="space-y-2">
              {counterparties.map((counterparty) => (
                <Card key={counterparty.counterpartyId}>
                  <CardContent className="p-3">
                    <p className="text-sm font-medium">{counterparty.name}</p>
                    <div className="mt-1 grid grid-cols-3 gap-2 text-xs">
                      <span className="text-muted-foreground">Закупка<br /><strong className="text-foreground">{formatRub(counterparty.purchased)}</strong></span>
                      <span className="text-muted-foreground">Выручка<br /><strong className="text-foreground">{formatRub(counterparty.revenue)}</strong></span>
                      <span className="text-muted-foreground">Прибыль<br /><strong className={counterparty.profit >= 0 ? "money-positive" : "money-negative"}>{formatRub(counterparty.profit)}</strong></span>
                    </div>
                  </CardContent>
                </Card>
              ))}
              {counterparties.length === 0 && <p className="py-8 text-center text-muted-foreground">Нет данных за период</p>}
            </div>
          </TabsContent>

          <TabsContent value="returns">
            <div className="space-y-2">
              {returns.map((item) => (
                <Card key={item.productId}>
                  <CardContent className="flex items-center justify-between p-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{item.name}</p>
                      <p className="text-xs text-muted-foreground">Возвратов: {item.returns}</p>
                    </div>
                    <span className="ml-3 text-sm font-semibold money-negative">{formatPercent(item.returnPercent)}</span>
                  </CardContent>
                </Card>
              ))}
              {returns.length === 0 && <p className="py-8 text-center text-muted-foreground">Нет данных за период</p>}
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
