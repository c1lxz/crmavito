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

interface Props {
  data: DynamicsPoint[];
  period: Period;
  onPeriodChange: (p: Period) => void;
}

const PERIODS: { value: Period; label: string }[] = [
  { value: "day", label: "Дни" },
  { value: "week", label: "Недели" },
  { value: "month", label: "Месяцы" },
];

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

function fmtYTick(v: number) {
  if (v === 0) return "0";
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)} млн`;
  if (v >= 1000) return `${Math.round(v / 1000)} тыс.`;
  return String(v);
}

export function DynamicsChart({ data, period, onPeriodChange }: Props) {
  const chartData = useMemo(() => aggregateByPeriod(data, period), [data, period]);
  const tickInterval = chartData.length > 10 ? Math.floor(chartData.length / 6) - 1 : 0;

  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold">Динамика за период</h3>
          <div className="flex gap-0.5 bg-muted rounded-lg p-0.5">
            {PERIODS.map(({ value, label }) => (
              <button
                key={value}
                onClick={() => onPeriodChange(value)}
                className={`text-[11px] px-2 py-0.5 rounded-md font-medium transition-colors ${
                  period === value
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap gap-5 mb-4">
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className="w-2.5 h-2.5 rounded-full inline-block" style={{ backgroundColor: "#7F77DD" }} />
            Выручка
          </span>
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className="w-2.5 h-2.5 rounded-full inline-block" style={{ backgroundColor: "#1D9E75" }} />
            Прибыль
          </span>
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className="w-2.5 h-2.5 rounded-full inline-block" style={{ backgroundColor: "#E08B2D" }} />
            Заказы
          </span>
        </div>

        {chartData.length === 0 ? (
          <div className="h-[220px] flex items-center justify-center text-sm text-muted-foreground">
            Нет данных за период
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke="#e5e7eb" strokeDasharray="4 4" />
              <XAxis
                dataKey="date"
                tick={{ fontSize: 10, fill: "#9ca3af" }}
                tickLine={false}
                axisLine={false}
                interval={tickInterval}
                tickFormatter={fmtXDate}
              />
              <YAxis
                yAxisId="money"
                tick={{ fontSize: 9, fill: "#9ca3af" }}
                tickLine={false}
                axisLine={false}
                tickFormatter={fmtYTick}
                width={62}
              />
              <YAxis
                yAxisId="orders"
                orientation="right"
                allowDecimals={false}
                tick={{ fontSize: 9, fill: "#d97706" }}
                tickLine={false}
                axisLine={false}
                width={32}
              />
              <Tooltip
                contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #e5e7eb" }}
                formatter={(v: number, name: string) => {
                  if (name === "orders") return [v.toLocaleString("ru-RU"), "Заказы"];
                  return [
                    v.toLocaleString("ru-RU") + " ₽",
                    name === "revenue" ? "Выручка" : "Прибыль",
                  ];
                }}
                labelFormatter={fmtXDate}
              />
              <Line
                type="monotone"
                yAxisId="money"
                dataKey="revenue"
                stroke="#7F77DD"
                strokeWidth={2}
                dot={{ r: 3, fill: "#7F77DD", strokeWidth: 0 }}
                activeDot={{ r: 5, fill: "#7F77DD" }}
                name="revenue"
              />
              <Line
                type="monotone"
                yAxisId="money"
                dataKey="profit"
                stroke="#1D9E75"
                strokeWidth={2}
                dot={{ r: 3, fill: "#1D9E75", strokeWidth: 0 }}
                activeDot={{ r: 5, fill: "#1D9E75" }}
                name="profit"
              />
              <Line
                type="monotone"
                yAxisId="orders"
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
