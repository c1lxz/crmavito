"use client";

import { useMemo } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { BarChart3, Home, NotebookPen, RotateCcw, ShoppingBag, Wallet } from "lucide-react";
import { Dock } from "@/components/ui/dock";
import { sanitizeOrderFilterQuery } from "@/lib/orders/filters";

const navItems = [
  { href: "/m/dashboard", match: "/dashboard", label: "Главная", icon: Home },
  { href: "/m/orders", match: "/orders", label: "Заказы", icon: ShoppingBag },
  { href: "/m/tasks", match: "/tasks", label: "Блокнот", icon: NotebookPen },
  { href: "/m/returns", match: "/returns", label: "Возвраты", icon: RotateCcw },
  { href: "/m/expenses", match: "/expenses", label: "Расходы", icon: Wallet },
  { href: "/m/reports", match: "/reports", label: "Отчёты", icon: BarChart3 },
];

export function BottomNav() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const currentQuery = searchParams.toString();
  const items = useMemo(() => {
    if (!pathname.startsWith("/orders") && !pathname.startsWith("/m/orders")) return navItems;

    const filterQuery =
      pathname === "/orders" || pathname === "/m/orders"
        ? sanitizeOrderFilterQuery(currentQuery)
        : sanitizeOrderFilterQuery(
            new URLSearchParams(currentQuery).get("returnTo") ?? "",
          );
    const ordersHref = filterQuery ? `/m/orders?${filterQuery}` : "/m/orders";
    return navItems.map((item) =>
      item.match === "/orders" ? { ...item, href: ordersHref } : item,
    );
  }, [currentQuery, pathname]);
  const activePath =
    pathname.startsWith("/warehouse") || pathname.startsWith("/m/warehouse")
      ? "/returns"
      : pathname;
  const activeIndex = navItems.findIndex(
    (item) => activePath.startsWith(item.href) || activePath.startsWith(item.match),
  );
  const activeHref = activeIndex >= 0 ? items[activeIndex].href : undefined;

  return (
    <div className="fixed bottom-0 left-0 right-0 z-40 mx-auto max-w-xl pointer-events-none">
      <Dock fullWidth className="pointer-events-auto" items={items} activeHref={activeHref} />
    </div>
  );
}
