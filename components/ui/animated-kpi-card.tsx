"use client";

import * as React from "react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

interface AnimatedKpiCardProps {
  label: string;
  value: string;
  delta?: number | null;
  index?: number;
  className?: string;
}

export function AnimatedKpiCard({
  label,
  value,
  delta,
  index = 0,
  className,
}: AnimatedKpiCardProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8, filter: "blur(8px)" }}
      animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
      transition={{ duration: 0.45, delay: index * 0.06, ease: [0.22, 1, 0.36, 1] }}
      whileHover={{ y: -2 }}
      className={cn(
        "rounded-xl border border-border bg-card",
        "shadow-sm hover:shadow-md transition-shadow",
        className
      )}
    >
      <div className="p-3">
        <p className="mb-2 text-[11px] font-medium leading-tight text-muted-foreground">{label}</p>
        <p className="text-xl font-bold tabular-nums leading-none">{value}</p>
        {delta != null && (
          <p
            className={cn(
              "text-[11px] mt-1.5 font-medium tabular-nums",
              delta >= 0 ? "text-success" : "text-destructive"
            )}
          >
            {delta >= 0 ? "↑" : "↓"} {Math.abs(delta).toLocaleString("ru-RU", { maximumFractionDigits: 1 })}%
          </p>
        )}
      </div>
    </motion.div>
  );
}
