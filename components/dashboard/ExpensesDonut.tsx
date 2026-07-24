"use client";

import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from "recharts";
import { Card, CardContent } from "@/components/ui/card";

export interface ExpenseItem {
  key: string;
  label: string;
  amount: number;
  color: string;
}

interface Props {
  data: ExpenseItem[];
  total: number;
}

const EMPTY_DATA = [{ key: "empty", label: "", amount: 1, color: "hsl(var(--muted))" }];

export function ExpensesDonut({ data, total }: Props) {
  const fmt = (v: number) => v.toLocaleString("ru-RU") + " ₽";
  const fmtPct = (v: number) =>
    v.toLocaleString("ru-RU", { maximumFractionDigits: 1 }) + "%";

  const filled = data.filter((d) => d.amount > 0);
  const chartData = filled.length > 0 ? filled : EMPTY_DATA;

  const centerLabel =
    total >= 1000
      ? `${Math.round(total / 1000).toLocaleString("ru-RU")} тыс. ₽`
      : fmt(total);

  return (
    <Card>
      <CardContent className="p-4">
        <h3 className="text-sm font-semibold mb-4">Структура расходов</h3>

        <div className="relative w-40 h-40 mx-auto mb-4">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={chartData}
                dataKey="amount"
                cx="50%"
                cy="50%"
                innerRadius="60%"
                outerRadius="88%"
                paddingAngle={filled.length > 1 ? 3 : 0}
                strokeWidth={0}
                startAngle={90}
                endAngle={-270}
              >
                {chartData.map((entry, i) => (
                  <Cell key={i} fill={entry.color} />
                ))}
              </Pie>
              {filled.length > 0 && (
                <Tooltip
                  formatter={(v: number) => fmt(v)}
                  contentStyle={{ fontSize: 11, borderRadius: 8 }}
                  wrapperStyle={{ zIndex: 20 }}
                />
              )}
            </PieChart>
          </ResponsiveContainer>
          <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
            <span className="text-sm font-bold leading-tight">{centerLabel}</span>
            <span className="text-[10px] text-muted-foreground mt-0.5">Всего расходов</span>
          </div>
        </div>

        <div className="space-y-2">
          {filled.length === 0 && (
            <p className="text-xs text-muted-foreground text-center py-2">Нет расходов за период</p>
          )}
          {filled.map((item) => {
            const pct = total > 0 ? (item.amount / total) * 100 : 0;
            return (
              <div key={item.key} className="flex items-center gap-2">
                <div
                  className="w-2.5 h-2.5 rounded-sm flex-shrink-0"
                  style={{ backgroundColor: item.color }}
                />
                <span className="text-xs text-muted-foreground flex-1 min-w-0 truncate">
                  {item.label}
                </span>
                <span className="text-xs font-medium whitespace-nowrap">{fmt(item.amount)}</span>
                <span className="text-xs text-muted-foreground whitespace-nowrap">
                  ({fmtPct(pct)})
                </span>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
