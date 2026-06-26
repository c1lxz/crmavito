"use client";

import type { LucideIcon } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

export interface MetricCardProps {
  label: string;
  value: number;
  format?: (v: number) => string;
  prevValue?: number;
  icon: LucideIcon;
  iconBg: string;
}

export function MetricCard({ label, value, format, prevValue, icon: Icon, iconBg }: MetricCardProps) {
  const fmt = format ?? ((v: number) => new Intl.NumberFormat("ru-RU").format(v) + " ₽");
  const delta = prevValue != null && prevValue > 0 ? ((value - prevValue) / prevValue) * 100 : null;

  return (
    <Card className="overflow-hidden">
      <CardContent className="p-3">
        <div className="flex items-start justify-between mb-2">
          <p className="text-[11px] font-semibold leading-tight text-foreground/60">{label}</p>
          <div className={`w-7 h-7 rounded-md ${iconBg} flex items-center justify-center flex-shrink-0 -mt-0.5`}>
            <Icon className="h-3.5 w-3.5 text-white" />
          </div>
        </div>
        <p className="text-lg font-semibold leading-tight tabular-nums">{fmt(value)}</p>
        {delta !== null && (
          <p className={`text-xs mt-1 font-medium ${delta >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-500"}`}>
            {delta >= 0 ? "+" : ""}
            {delta.toLocaleString("ru-RU", { maximumFractionDigits: 1 })}% к прошлому периоду
          </p>
        )}
      </CardContent>
    </Card>
  );
}
