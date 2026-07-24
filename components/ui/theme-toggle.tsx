"use client";
import { useTheme } from "next-themes";
import { Moon, Sun, Monitor } from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

interface ThemeToggleProps {
  variant?: "icon" | "buttons";
  className?: string;
}

export function ThemeToggle({ variant = "icon", className }: ThemeToggleProps) {
  const { theme, resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);
  if (!mounted) {
    return variant === "icon"
      ? <span aria-hidden className={cn("block h-11 w-11", className)} />
      : <span aria-hidden className={cn("block h-[4.25rem] w-full", className)} />;
  }

  if (variant === "buttons") {
    const options = [
      { value: "light", label: "Светлая", icon: Sun },
      { value: "system", label: "Авто", icon: Monitor },
      { value: "dark", label: "Тёмная", icon: Moon },
    ];
    return (
      <div
        className={cn("grid grid-cols-3 overflow-hidden rounded-lg border border-border bg-secondary/55 p-1", className)}
        role="group"
        aria-label="Цветовая тема"
      >
        {options.map(({ value, label, icon: Icon }) => (
          <button
            key={value}
            type="button"
            onClick={() => setTheme(value)}
            aria-pressed={theme === value}
            className={cn(
              "flex min-h-14 flex-col items-center justify-center gap-1 rounded-md px-2 text-xs font-semibold transition-[background-color,color,box-shadow] duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              theme === value
                ? "bg-card text-foreground shadow-sm"
                : "text-muted-foreground hover:bg-card/60 hover:text-foreground"
            )}
          >
            <Icon className={cn("h-4 w-4", theme === value && "text-primary")} />
            {label}
          </button>
        ))}
      </div>
    );
  }

  const isDark = resolvedTheme === "dark";
  return (
    <button
      type="button"
      onClick={() => setTheme(isDark ? "light" : "dark")}
      aria-label={isDark ? "Включить светлую тему" : "Включить тёмную тему"}
      title={isDark ? "Светлая тема" : "Тёмная тема"}
      className={cn(
        "inline-flex h-11 w-11 items-center justify-center rounded-md border border-border bg-card text-foreground shadow-sm transition-[background-color,border-color,color,box-shadow] duration-200 hover:border-primary/35 hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        className,
      )}
    >
      {isDark ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
    </button>
  );
}
