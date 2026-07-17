"use client";

import { useMemo } from "react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";
import { Card, CardContent } from "@/components/ui/card";

export interface DynamicsPoint {
  date: string;
  revenue: number;
  profit: number;
  orders: number;
}

export type Period = "day" | "week" | "month";

interface BaseProps {
  data: DynamicsPoint[];
  period: Period;
  onPeriodChange: (p: Period) => void;
}

const PERIODS: { value: Period; label: string }[] = [
  { value: "day", label: "Дни" },
  { value: "week", label: "Недели" },
  { value: "month", label: "Месяцы" },
];
const TOOLTIP_CONTENT_STYLE = {
  backgroundColor: "#ffffff",
  border: "1px solid #e5e7eb",
  borderRadius: 8,
  color: "#111827",
  fontSize: 12,
};
const TOOLTIP_LABEL_STYLE = {
  color: "#111827",
  fontWeight: 600,
};

function fmtXDate(d: string) {
  const date = new Date(d);
  return date.toLocaleString("ru-RU", { day: "numeric", month: "short" }).replace(".", "");
}

function periodKey(dateText: string, period: Period) {
  const date = new Date(`${dateText}T00:00:00`);
  if (period === "month") return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-01`;
  if (period === "week") {
    const day = date.getDay() || 7;
    date.setDate(date.getDate() - day + 1);
    return date.toISOString().slice(0, 10);
  }
  return dateText;
}

function aggregateByPeriod(data: DynamicsPoint[], period: Period): DynamicsPoint[] {
  const buckets: Record<string, DynamicsPoint> = {};
  for (const point of data) {
    const key = periodKey(point.date, period);
    if (!buckets[key]) buckets[key] = { date: key, revenue: 0, profit: 0, orders: 0 };
    buckets[key].revenue += point.revenue;
    buckets[key].profit += point.profit;
    buckets[key].orders += point.orders;
  }
  return Object.values(buckets).sort((a, b) => a.date.localeCompare(b.date));
}

function formatAverage(value: number) {
  return value.toLocaleString("ru-RU", {
    maximumFractionDigits: value >= 10 ? 1 : 2,
  });
}

function getAverageOrders(data: DynamicsPoint[]) {
  const total = data.reduce((sum, point) => sum + point.orders, 0);
  const byDay = aggregateByPeriod(data, "day");
  const byWeek = aggregateByPeriod(data, "week");
  const byMonth = aggregateByPeriod(data, "month");

  return {
    day: byDay.length ? total / byDay.length : 0,
    week: byWeek.length ? total / byWeek.length : 0,
    month: byMonth.length ? total / byMonth.length : 0,
  };
}

function fmtYTick(v: number) {
  if (v === 0) return "0";
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)} млн`;
  if (v >= 1000) return `${Math.round(v / 1000)} тыс.`;
  return String(v);
}

function periodControls(period: Period, onPeriodChange: (p: Period) => void) {
  return (
    <div className="flex shrink-0 gap-0.5 rounded-lg bg-muted p-0.5">
      {PERIODS.map(({ value, label }) => (
        <button
          key={value}
          type="button"
          onClick={() => onPeriodChange(value)}
          className={`h-7 rounded-md px-2.5 text-[11px] font-medium leading-none transition-colors ${
            period === value
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function ChartHeader({ title, period, onPeriodChange }: BaseProps & { title: string }) {
  return (
    <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
      <h3 className="text-sm font-semibold leading-tight">{title}</h3>
      {periodControls(period, onPeriodChange)}
    </div>
  );
}

export function DynamicsChart({ data, period, onPeriodChange }: BaseProps) {
  const chartData = useMemo(() => aggregateByPeriod(data, period), [data, period]);
  const tickInterval = chartData.length > 6 ? Math.max(0, Math.ceil(chartData.length / 5) - 1) : 0;

  return (
    <Card className="min-w-0">
      <CardContent className="p-4">
        <ChartHeader title="Динамика за период" data={data} period={period} onPeriodChange={onPeriodChange} />

        <div className="mb-4 flex flex-wrap gap-x-5 gap-y-2">
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: "#7F77DD" }} />
            Выручка
          </span>
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: "#1D9E75" }} />
            Прибыль
          </span>
        </div>

        {chartData.length === 0 ? (
          <div className="flex h-[240px] items-center justify-center text-sm text-muted-foreground">
            Нет данных за период
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={chartData} margin={{ top: 6, right: 12, left: 2, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke="#e5e7eb" strokeDasharray="4 4" />
              <XAxis
                dataKey="date"
                tick={{ fontSize: 10, fill: "#9ca3af" }}
                tickLine={false}
                axisLine={false}
                interval={tickInterval}
                minTickGap={26}
                tickFormatter={fmtXDate}
              />
              <YAxis
                tick={{ fontSize: 9, fill: "#9ca3af" }}
                tickLine={false}
                axisLine={false}
                tickFormatter={fmtYTick}
                width={62}
              />
              <Tooltip
                contentStyle={TOOLTIP_CONTENT_STYLE}
                labelStyle={TOOLTIP_LABEL_STYLE}
                itemStyle={{ color: "#111827" }}
                formatter={(v: number, name: string) => [
                  v.toLocaleString("ru-RU") + " ₽",
                  name === "revenue" ? "Выручка" : "Прибыль",
                ]}
                labelFormatter={fmtXDate}
              />
              <Line
                type="monotone"
                dataKey="revenue"
                stroke="#7F77DD"
                strokeWidth={2}
                dot={{ r: 3, fill: "#7F77DD", strokeWidth: 0 }}
                activeDot={{ r: 5, fill: "#7F77DD" }}
                name="revenue"
              />
              <Line
                type="monotone"
                dataKey="profit"
                stroke="#1D9E75"
                strokeWidth={2}
                dot={{ r: 3, fill: "#1D9E75", strokeWidth: 0 }}
                activeDot={{ r: 5, fill: "#1D9E75" }}
                name="profit"
              />
            </LineChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
}

export function OrdersDynamicsChart({ data, period, onPeriodChange }: BaseProps) {
  const chartData = useMemo(() => aggregateByPeriod(data, period), [data, period]);
  const averages = useMemo(() => getAverageOrders(data), [data]);
  const tickInterval = chartData.length > 6 ? Math.max(0, Math.ceil(chartData.length / 5) - 1) : 0;

  return (
    <Card className="min-w-0">
      <CardContent className="p-4">
        <ChartHeader title="Динамика заказов" data={data} period={period} onPeriodChange={onPeriodChange} />

        <div className="mb-4 flex flex-wrap gap-x-5 gap-y-2">
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: "#E08B2D" }} />
            Заказы
          </span>
        </div>

        <div className="mb-4 grid grid-cols-3 gap-2">
          {[
            ["Сред. в день", averages.day],
            ["Сред. в неделю", averages.week],
            ["Сред. в месяц", averages.month],
          ].map(([label, value]) => (
            <div key={label} className="rounded-md border border-border/70 bg-muted/25 px-2.5 py-2">
              <p className="truncate text-[10px] text-muted-foreground">{label}</p>
              <p className="mt-0.5 text-sm font-semibold tabular-nums">{formatAverage(Number(value))}</p>
            </div>
          ))}
        </div>

        {chartData.length === 0 ? (
          <div className="flex h-[240px] items-center justify-center text-sm text-muted-foreground">
            Нет данных за период
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={chartData} margin={{ top: 6, right: 12, left: 2, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke="#e5e7eb" strokeDasharray="4 4" />
              <XAxis
                dataKey="date"
                tick={{ fontSize: 10, fill: "#9ca3af" }}
                tickLine={false}
                axisLine={false}
                interval={tickInterval}
                minTickGap={26}
                tickFormatter={fmtXDate}
              />
              <YAxis
                allowDecimals={false}
                tick={{ fontSize: 9, fill: "#9ca3af" }}
                tickLine={false}
                axisLine={false}
                width={42}
              />
              <Tooltip
                contentStyle={TOOLTIP_CONTENT_STYLE}
                labelStyle={TOOLTIP_LABEL_STYLE}
                itemStyle={{ color: "#111827" }}
                formatter={(v: number) => [v.toLocaleString("ru-RU"), "Заказы"]}
                labelFormatter={fmtXDate}
              />
              <Line
                type="monotone"
                dataKey="orders"
                stroke="#E08B2D"
                strokeWidth={2}
                dot={{ r: 3, fill: "#E08B2D", strokeWidth: 0 }}
                activeDot={{ r: 5, fill: "#E08B2D" }}
                name="orders"
              />
            </LineChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
}
