"use client";

import * as React from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { LucideIcon } from "lucide-react";

interface DockItem {
  icon: LucideIcon;
  label: string;
  href: string;
}

interface DockProps {
  className?: string;
  fullWidth?: boolean;
  items: DockItem[];
  activeHref?: string;
}

const Dock = React.forwardRef<HTMLDivElement, DockProps>(
  ({ items, className, fullWidth = false, activeHref }, ref) => {
    return (
      <div ref={ref} className={cn("w-full flex items-center justify-center", className)}>
        <div
          className={cn(
            "relative",
            fullWidth ? "w-full" : "w-full max-w-4xl"
          )}
        >
          <div
            className={cn(
              "flex items-center gap-1 border-t border-border/85 bg-card/96 px-2 py-1.5 shadow-[0_-10px_30px_rgba(15,23,42,0.08)] backdrop-blur-md",
              fullWidth && "w-full justify-around"
            )}
          >
            {items.map(({ icon: Icon, label, href }) => {
              const isActive = activeHref === href;
              return (
                <Link
                  key={href}
                  href={href}
                  prefetch
                  aria-label={label}
                  aria-current={isActive ? "page" : undefined}
                  className={cn(
                    "relative flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-md px-2 py-1.5",
                    "transition-colors active:bg-secondary",
                    isActive
                      ? "text-primary"
                      : "text-muted-foreground"
                  )}
                >
                  <Icon
                    className={cn(
                      "h-5 w-5 transition-transform",
                      isActive && "-translate-y-0.5"
                    )}
                  />
                  <span className="text-[10px] leading-none font-medium">{label}</span>
                </Link>
              );
            })}
          </div>
        </div>
      </div>
    );
  }
);
Dock.displayName = "Dock";

export { Dock };
