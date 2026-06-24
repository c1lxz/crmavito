"use client";

import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";
import { Card, CardContent } from "@/components/ui/card";

export interface DynamicsPoint {
  date: string;
  revenue: number;
  profit: number;
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

function fmtYTick(v: number) {
  if (v === 0) return "0";
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)} млн`;
  if (v >= 1000) return `${Math.round(v / 1000)} тыс.`;
  return String(v);
}

export function DynamicsChart({ data, period, onPeriodChange }: Props) {
  const tickInterval = data.length > 10 ? Math.floor(data.length / 6) - 1 : 0;

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

        <div className="flex gap-5 mb-4">
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className="w-2.5 h-2.5 rounded-full inline-block" style={{ backgroundColor: "#7F77DD" }} />
            Выручка
          </span>
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className="w-2.5 h-2.5 rounded-full inline-block" style={{ backgroundColor: "#1D9E75" }} />
            Прибыль
          </span>
        </div>

        {data.length === 0 ? (
          <div className="h-[220px] flex items-center justify-center text-sm text-muted-foreground">
            Нет данных за период
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
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
                tick={{ fontSize: 9, fill: "#9ca3af" }}
                tickLine={false}
                axisLine={false}
                tickFormatter={fmtYTick}
                width={62}
              />
              <Tooltip
                contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #e5e7eb" }}
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
