"use client";

import { useMemo } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { BarChart3, Home, RotateCcw, ShoppingBag, Wallet } from "lucide-react";
import { Dock } from "@/components/ui/dock";
import { sanitizeOrderFilterQuery } from "@/lib/orders/filters";

const navItems = [
  { href: "/dashboard", label: "Главная", icon: Home },
  { href: "/orders", label: "Заказы", icon: ShoppingBag },
  { href: "/returns", label: "Возвраты", icon: RotateCcw },
  { href: "/expenses", label: "Расходы", icon: Wallet },
  { href: "/reports", label: "Отчёты", icon: BarChart3 },
];

export function BottomNav() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const currentQuery = searchParams.toString();
  const items = useMemo(() => {
    if (!pathname.startsWith("/orders")) return navItems;

    const filterQuery =
      pathname === "/orders"
        ? sanitizeOrderFilterQuery(currentQuery)
        : sanitizeOrderFilterQuery(
            new URLSearchParams(currentQuery).get("returnTo") ?? "",
          );
    const ordersHref = filterQuery ? `/orders?${filterQuery}` : "/orders";
    return navItems.map((item) =>
      item.href === "/orders" ? { ...item, href: ordersHref } : item,
    );
  }, [currentQuery, pathname]);
  const activeIndex = navItems.findIndex((item) => pathname.startsWith(item.href));
  const activeHref = activeIndex >= 0 ? items[activeIndex].href : undefined;

  return (
    <div className="fixed bottom-0 left-0 right-0 z-40 mx-auto max-w-xl pointer-events-none lg:hidden">
      <Dock fullWidth className="pointer-events-auto" items={items} activeHref={activeHref} />
    </div>
  );
}
