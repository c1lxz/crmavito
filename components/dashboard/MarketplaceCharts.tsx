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
const tooltipStyle = {
  backgroundColor: "hsl(var(--popover))",
  border: "1px solid hsl(var(--border))",
  borderRadius: 8,
  fontSize: 12,
};

function shortDate(value: string) {
  return new Date(`${value}T00:00:00`).toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "short",
  });
}

export function MarketplaceComparison({ report }: { report: MarketplaceReport }) {
  const comparison = report.summary.map((item) => ({
    name: item.marketplace === "AVITO" ? "Авито" : "WB",
    Выручка: item.revenue,
    Прибыль: item.profit,
  }));

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card className="min-w-0">
        <CardContent className="p-4">
          <h3 className="mb-4 text-sm font-semibold">Выручка и прибыль по площадкам</h3>
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={comparison} margin={{ left: 0, right: 8 }}>
              <CartesianGrid vertical={false} stroke="hsl(var(--border))" strokeDasharray="4 4" />
              <XAxis dataKey="name" tickLine={false} axisLine={false} />
              <YAxis tickLine={false} axisLine={false} width={55} />
              <Tooltip contentStyle={tooltipStyle} formatter={(value: number) => formatRub(value)} />
              <Legend />
              <Bar dataKey="Выручка" fill={AVITO_COLOR} radius={[5, 5, 0, 0]} />
              <Bar dataKey="Прибыль" fill={WB_COLOR} radius={[5, 5, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <Card className="min-w-0">
        <CardContent className="p-4">
          <h3 className="mb-4 text-sm font-semibold">Динамика прибыли Авито / WB</h3>
          {report.dynamics.length ? (
            <ResponsiveContainer width="100%" height={250}>
              <LineChart data={report.dynamics} margin={{ left: 0, right: 10 }}>
                <CartesianGrid vertical={false} stroke="hsl(var(--border))" strokeDasharray="4 4" />
                <XAxis dataKey="date" tickFormatter={shortDate} tickLine={false} axisLine={false} />
                <YAxis tickLine={false} axisLine={false} width={55} />
                <Tooltip
                  contentStyle={tooltipStyle}
                  labelFormatter={shortDate}
                  formatter={(value: number) => formatRub(value)}
                />
                <Legend />
                <Line type="monotone" dataKey="avitoProfit" name="Авито" stroke={AVITO_COLOR} strokeWidth={2} />
                <Line type="monotone" dataKey="wbProfit" name="WB" stroke={WB_COLOR} strokeWidth={2} />
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
