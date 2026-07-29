"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

type Tone = "violet" | "sky" | "emerald" | "orange" | "red" | "slate";

const TONE_STYLES: Record<Tone, { bg: string; text: string; dot: string }> = {
  violet: {
    bg: "bg-special/15",
    text: "text-special",
    dot: "bg-special",
  },
  sky: {
    bg: "bg-info/15",
    text: "text-info",
    dot: "bg-info",
  },
  emerald: {
    bg: "bg-success/15",
    text: "text-success",
    dot: "bg-success",
  },
  orange: {
    bg: "bg-warning/15",
    text: "text-warning",
    dot: "bg-warning",
  },
  red: {
    bg: "bg-destructive/15",
    text: "text-destructive",
    dot: "bg-destructive",
  },
  slate: {
    bg: "bg-muted",
    text: "text-muted-foreground",
    dot: "bg-muted-foreground",
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
