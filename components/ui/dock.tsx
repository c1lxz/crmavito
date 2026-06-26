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
      <div ref={ref} className={cn("w-full flex items-center justify-center p-2", className)}>
        <div
          className={cn(
            "rounded-2xl relative",
            fullWidth ? "w-full" : "w-full max-w-4xl"
          )}
        >
          <div
            className={cn(
              "flex items-center gap-1 p-2 rounded-2xl",
              "backdrop-blur-lg border shadow-lg",
              "bg-background/90 border-border",
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
                    "flex flex-col items-center justify-center gap-0.5 px-3 py-1.5 rounded-xl",
                    "transition-colors active:bg-secondary",
                    isActive
                      ? "text-foreground"
                      : "text-muted-foreground"
                  )}
                >
                  <Icon
                    className={cn(
                      "w-5 h-5 transition-transform",
                      isActive && "scale-110"
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
