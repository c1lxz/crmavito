"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

type Tone = "violet" | "sky" | "emerald" | "orange" | "red" | "slate";

const TONE_STYLES: Record<Tone, { bg: string; text: string; dot: string }> = {
  violet: {
    bg: "bg-violet-500/15",
    text: "text-violet-700 dark:text-violet-300",
    dot: "bg-violet-500",
  },
  sky: {
    bg: "bg-sky-500/15",
    text: "text-sky-700 dark:text-sky-300",
    dot: "bg-sky-500",
  },
  emerald: {
    bg: "bg-emerald-500/15",
    text: "text-emerald-700 dark:text-emerald-300",
    dot: "bg-emerald-500",
  },
  orange: {
    bg: "bg-orange-500/15",
    text: "text-orange-700 dark:text-orange-300",
    dot: "bg-orange-500",
  },
  red: {
    bg: "bg-red-500/15",
    text: "text-red-700 dark:text-red-300",
    dot: "bg-red-500",
  },
  slate: {
    bg: "bg-slate-500/15",
    text: "text-slate-600 dark:text-slate-400",
    dot: "bg-slate-500",
  },
};

interface StatusBadgeProps {
  tone: Tone;
  pulse?: boolean;
  className?: string;
  children: React.ReactNode;
}

export function StatusBadge({ tone, pulse = false, className, children }: StatusBadgeProps) {
  const s = TONE_STYLES[tone];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md px-1.5 py-0.5 text-xs font-semibold",
        s.bg,
        s.text,
        className
      )}
    >
      <span className="relative flex h-1.5 w-1.5">
        {pulse && (
          <span
            className={cn(
              "absolute inline-flex h-full w-full animate-ping rounded-full opacity-70",
              s.dot
            )}
          />
        )}
        <span className={cn("relative inline-flex h-1.5 w-1.5 rounded-full", s.dot)} />
      </span>
      {children}
    </span>
  );
}

export type { Tone as StatusBadgeTone };
