"use client";

import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export interface MetricCardProps {
  label: string;
  value: number;
  format?: (v: number) => string;
  prevValue?: number;
  icon?: LucideIcon;
  iconBg?: string;
}

export function MetricCard({ label, value, format, prevValue }: MetricCardProps) {
  const fmt = format ?? ((v: number) => new Intl.NumberFormat("ru-RU").format(v) + " ₽");
  const delta = prevValue != null && prevValue > 0 ? ((value - prevValue) / prevValue) * 100 : null;

  return (
    <div className="rounded-xl border border-border bg-card p-3 shadow-sm">
      <p className="text-[11px] font-semibold text-foreground/55 leading-tight mb-2">{label}</p>
      <p className="dashboard-metric-value text-xl font-bold tabular-nums leading-none">{fmt(value)}</p>
      {delta !== null && (
        <p
          className={cn(
            "text-[11px] mt-1.5 font-medium tabular-nums",
            delta >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-500"
          )}
        >
          {delta >= 0 ? "↑" : "↓"} {Math.abs(delta).toLocaleString("ru-RU", { maximumFractionDigits: 1 })}%
        </p>
      )}
    </div>
  );
}
