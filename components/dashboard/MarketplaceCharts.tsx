"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Card, CardContent } from "@/components/ui/card";
import { formatRub } from "@/lib/utils";

export interface MarketplaceReport {
  summary: Array<{
    marketplace: "AVITO" | "WB";
    orders: number;
    revenue: number;
    profit: number;
  }>;
  dynamics: Array<{
    date: string;
    avitoOrders: number;
    wbOrders: number;
    avitoProfit: number;
    wbProfit: number;
  }>;
}

const AVITO_COLOR = "hsl(var(--chart-1))";
const WB_COLOR = "hsl(var(--special))";
const CHART_TEXT_COLOR = "hsl(var(--muted-foreground))";
const CHART_GRID_COLOR = "hsl(var(--border))";
const tooltipStyle = {
  backgroundColor: "hsl(var(--popover))",
  border: `1px solid ${CHART_GRID_COLOR}`,
  borderRadius: 8,
  color: "hsl(var(--popover-foreground))",
  fontSize: 13,
  boxShadow: "0 10px 30px hsl(var(--background) / 0.22)",
};
const axisTick = { fill: CHART_TEXT_COLOR, fontSize: 12 };
const legendStyle = {
  color: CHART_TEXT_COLOR,
  fontSize: 12,
  lineHeight: "20px",
  paddingTop: 8,
};

function shortDate(value: string) {
  return new Date(`${value}T00:00:00`).toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "short",
  });
}

function compactRub(value: number) {
  return new Intl.NumberFormat("ru-RU", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

export function MarketplaceComparison({ report }: { report: MarketplaceReport }) {
  const comparison = report.summary.map((item) => ({
    name: item.marketplace === "AVITO" ? "Авито" : "WB",
    Выручка: item.revenue,
    Прибыль: item.profit,
  }));

  return (
    <div className="marketplace-comparison-grid grid gap-4 lg:grid-cols-2">
      <Card className="min-w-0">
        <CardContent className="p-4">
          <h3 className="mb-3 text-base font-semibold leading-snug text-foreground">
            Выручка и прибыль по площадкам
          </h3>
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={comparison} margin={{ top: 4, left: 2, right: 8, bottom: 2 }}>
              <CartesianGrid vertical={false} stroke={CHART_GRID_COLOR} strokeDasharray="4 4" />
              <XAxis dataKey="name" tick={axisTick} tickLine={false} axisLine={false} tickMargin={8} />
              <YAxis
                tick={axisTick}
                tickFormatter={(value: number) => compactRub(value)}
                tickLine={false}
                axisLine={false}
                width={64}
              />
              <Tooltip
                cursor={false}
                contentStyle={tooltipStyle}
                labelStyle={{ color: "hsl(var(--popover-foreground))" }}
                itemStyle={{ color: "hsl(var(--popover-foreground))" }}
                formatter={(value: number) => formatRub(value)}
              />
              <Legend wrapperStyle={legendStyle} />
              <Bar dataKey="Выручка" fill={AVITO_COLOR} radius={[5, 5, 0, 0]} activeBar={false} />
              <Bar dataKey="Прибыль" fill={WB_COLOR} radius={[5, 5, 0, 0]} activeBar={false} />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <Card className="min-w-0">
        <CardContent className="p-4">
          <h3 className="mb-3 text-base font-semibold leading-snug text-foreground">
            Динамика прибыли Авито / WB
          </h3>
          {report.dynamics.length ? (
            <ResponsiveContainer width="100%" height={250}>
              <LineChart data={report.dynamics} margin={{ top: 4, left: 2, right: 10, bottom: 2 }}>
                <CartesianGrid vertical={false} stroke={CHART_GRID_COLOR} strokeDasharray="4 4" />
                <XAxis
                  dataKey="date"
                  tick={axisTick}
                  tickFormatter={shortDate}
                  tickLine={false}
                  axisLine={false}
                  tickMargin={8}
                  minTickGap={28}
                />
                <YAxis
                  tick={axisTick}
                  tickFormatter={(value: number) => compactRub(value)}
                  tickLine={false}
                  axisLine={false}
                  width={64}
                />
                <Tooltip
                  cursor={false}
                  contentStyle={tooltipStyle}
                  labelStyle={{ color: "hsl(var(--popover-foreground))" }}
                  itemStyle={{ color: "hsl(var(--popover-foreground))" }}
                  labelFormatter={shortDate}
                  formatter={(value: number) => formatRub(value)}
                />
                <Legend wrapperStyle={legendStyle} />
                <Line
                  type="monotone"
                  dataKey="avitoProfit"
                  name="Авито"
                  stroke={AVITO_COLOR}
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 4, fill: AVITO_COLOR, stroke: AVITO_COLOR }}
                />
                <Line
                  type="monotone"
                  dataKey="wbProfit"
                  name="WB"
                  stroke={WB_COLOR}
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 4, fill: WB_COLOR, stroke: WB_COLOR }}
                />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex h-[250px] items-center justify-center text-sm text-muted-foreground">
              Нет данных за период
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
