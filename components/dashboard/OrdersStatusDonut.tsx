"use client";

import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from "recharts";
import { Card, CardContent } from "@/components/ui/card";

export interface OrderStatusItem {
  status: string;
  label: string;
  count: number;
  color: string;
}

interface Props {
  title?: string;
  data: OrderStatusItem[];
  total: number;
  centerValue?: string;
  centerLabel?: string;
}

const EMPTY_DATA = [{ status: "empty", label: "", count: 1, color: "#e5e7eb" }];

export function OrdersStatusDonut({
  title = "Заказы по статусам",
  data,
  total,
  centerValue,
  centerLabel = "Всего",
}: Props) {
  const fmtPct = (v: number) =>
    v.toLocaleString("ru-RU", { maximumFractionDigits: 1 }) + "%";

  const filled = data.filter((d) => d.count > 0);
  const chartData = filled.length > 0 ? filled : EMPTY_DATA;

  return (
    <Card>
      <CardContent className="p-4">
        <h3 className="text-sm font-semibold mb-4">{title}</h3>

        <div className="relative w-40 h-40 mx-auto mb-4">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={chartData}
                dataKey="count"
                nameKey="label"
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
                  formatter={(v: number, _: string, props: { payload?: { label?: string } }) => [
                    `${v} шт.`,
                    props.payload?.label ?? "",
                  ]}
                  contentStyle={{ fontSize: 11, borderRadius: 8 }}
                  wrapperStyle={{ zIndex: 20 }}
                />
              )}
            </PieChart>
          </ResponsiveContainer>
          <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
            <span className="text-xl font-bold leading-tight">{centerValue ?? total}</span>
            <span className="text-[10px] text-muted-foreground mt-0.5">{centerLabel}</span>
          </div>
        </div>

        <div className="space-y-2">
          {filled.map((item) => {
            const pct = total > 0 ? (item.count / total) * 100 : 0;
            return (
              <div key={item.status} className="flex items-center gap-2">
                <div
                  className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                  style={{ backgroundColor: item.color }}
                />
                <span className="text-xs text-muted-foreground flex-1">{item.label}</span>
                <span className="text-xs font-medium">{item.count}</span>
                <span className="text-xs text-muted-foreground">({fmtPct(pct)})</span>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
