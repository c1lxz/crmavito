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
} from "lucide-react";
import { cn } from "@/lib/utils";

const navItems = [
  { href: "/pc/dashboard", match: "/dashboard", label: "Главная", icon: Home },
  { href: "/pc/orders", match: "/orders", label: "Заказы", icon: ShoppingBag },
  { href: "/pc/tasks", match: "/tasks", label: "Блокнот", icon: NotebookPen },
  { href: "/pc/returns", match: "/returns", label: "Возвраты", icon: RotateCcw },
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
    <aside className="fixed inset-y-0 left-0 z-40 hidden w-64 border-r border-sidebar-border bg-sidebar text-sidebar-foreground lg:flex lg:flex-col">
      <div className="flex h-16 items-center gap-3 border-b border-sidebar-border px-5">
        <div className="flex h-9 w-9 items-center justify-center rounded-md bg-sidebar-primary text-sidebar-primary-foreground">
          <PackageSearch className="h-5 w-5" />
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
              aria-current={isActive ? "page" : undefined}
              className={cn(
                "flex h-10 items-center gap-3 rounded-md px-3 text-sm font-medium transition-colors",
                isActive
                  ? "bg-sidebar-primary text-sidebar-primary-foreground shadow-sm"
                  : "text-sidebar-foreground/76 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
              )}
            >
              <Icon className="h-4 w-4" />
              {label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
