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
  showSlicePercentLabels?: boolean;
}

const EMPTY_DATA = [{ status: "empty", label: "", count: 1, color: "#e5e7eb" }];

type PercentLabelProps = {
  cx?: number | string;
  cy?: number | string;
  midAngle?: number;
  outerRadius?: number | string;
  percent?: number;
  fill?: string;
};

function fmtPct(v: number) {
  return v.toLocaleString("ru-RU", { maximumFractionDigits: 1 }) + "%";
}

function toNumber(value: number | string | undefined, fallback = 0) {
  return typeof value === "number" ? value : Number(value) || fallback;
}

function renderPercentLabel(props: PercentLabelProps) {
  const percent = props.percent ?? 0;
  if (percent <= 0) return null;

  const cx = toNumber(props.cx);
  const cy = toNumber(props.cy);
  const radius = toNumber(props.outerRadius) + 10;
  const angle = -((props.midAngle ?? 0) * Math.PI) / 180;
  const x = cx + radius * Math.cos(angle);
  const y = cy + radius * Math.sin(angle);

  return (
    <text
      x={x}
      y={y}
      fill={props.fill ?? "currentColor"}
      textAnchor={x > cx ? "start" : "end"}
      dominantBaseline="central"
      className="text-[11px] font-semibold"
    >
      {fmtPct(percent * 100)}
    </text>
  );
}

export function OrdersStatusDonut({
  title = "Заказы по статусам",
  data,
  total,
  centerValue,
  centerLabel = "Всего",
  showSlicePercentLabels = false,
}: Props) {
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
                outerRadius={showSlicePercentLabels ? "74%" : "88%"}
                paddingAngle={filled.length > 1 ? 3 : 0}
                strokeWidth={0}
                startAngle={90}
                endAngle={-270}
                label={showSlicePercentLabels ? renderPercentLabel : false}
                labelLine={false}
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
                {!showSlicePercentLabels && (
                  <span className="text-xs text-muted-foreground">({fmtPct(pct)})</span>
                )}
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
