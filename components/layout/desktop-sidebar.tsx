"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BarChart3,
  Boxes,
  Home,
  NotebookPen,
  PackageSearch,
  RotateCcw,
  Settings,
  Sparkles,
  ShoppingBag,
  Store,
  Users,
  Wallet,
  Warehouse,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { ThemeToggle } from "@/components/ui/theme-toggle";

const navItems = [
  { href: "/pc/dashboard", match: "/dashboard", label: "Главная", icon: Home },
  { href: "/pc/orders", match: "/orders", label: "Заказы", icon: ShoppingBag },
  { href: "/pc/tasks", match: "/tasks", label: "Блокнот", icon: NotebookPen },
  { href: "/pc/returns", match: "/returns", label: "Возвраты", icon: RotateCcw },
  { href: "/pc/warehouse", match: "/warehouse", label: "Склад", icon: Warehouse },
  { href: "/pc/products", match: "/products", label: "Товары", icon: Boxes },
  { href: "/pc/wbr", match: "/wbr", label: "WB Resale", icon: Store },
  { href: "/pc/expenses", match: "/expenses", label: "Расходы", icon: Wallet },
  { href: "/pc/counterparties", match: "/counterparties", label: "Поставщики", icon: Users },
  { href: "/pc/reports", match: "/reports", label: "Отчёты", icon: BarChart3 },
  { href: "/pc/content-machine", match: "/content-machine", label: "Контент-машина", icon: Sparkles },
  { href: "/pc/settings", match: "/settings", label: "Настройки", icon: Settings },
];

export function DesktopSidebar() {
  const pathname = usePathname();

  return (
    <aside className="fixed inset-y-0 left-0 z-40 hidden w-64 border-r border-sidebar-border bg-sidebar text-sidebar-foreground shadow-[6px_0_24px_hsl(var(--foreground)/0.025)] lg:flex lg:flex-col">
      <div className="flex h-16 items-center gap-3 border-b border-sidebar-border/60 px-5">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground shadow-sm shadow-sidebar-primary/15">
          <PackageSearch className="h-[18px] w-[18px]" />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-semibold leading-tight">CRM Avito</p>
          <p className="text-xs text-sidebar-foreground/60">Рабочая панель</p>
        </div>
      </div>

      <nav className="flex-1 space-y-1 px-3 py-4">
        {navItems.map(({ href, match, label, icon: Icon }) => {
          const isActive =
            pathname === href ||
            pathname.startsWith(`${href}/`) ||
            pathname === match ||
            pathname.startsWith(`${match}/`);
          return (
            <Link
              key={href}
              href={href}
              prefetch={false}
              aria-current={isActive ? "page" : undefined}
              className={cn(
                "flex h-10 items-center gap-3 rounded-lg px-3 text-sm font-medium transition-[background-color,color,box-shadow] duration-150",
                isActive
                  ? "bg-sidebar-primary/12 text-sidebar-primary ring-1 ring-inset ring-sidebar-primary/15"
                  : "text-sidebar-foreground/70 hover:bg-sidebar-accent/80 hover:text-sidebar-accent-foreground",
              )}
            >
              <Icon className="h-4 w-4" />
              {label}
            </Link>
          );
        })}
      </nav>

      <div className="flex items-center justify-between border-t border-sidebar-border/60 px-4 py-3">
        <div>
          <p className="text-xs font-semibold text-sidebar-foreground">Оформление</p>
          <p className="text-[11px] text-sidebar-foreground/55">Светлая / тёмная</p>
        </div>
        <ThemeToggle className="border-sidebar-border bg-sidebar-accent text-sidebar-foreground shadow-none hover:border-sidebar-primary/45 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-sidebar-ring focus-visible:ring-offset-sidebar" />
      </div>
    </aside>
  );
}
