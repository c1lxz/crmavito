"use client";

import { usePathname } from "next/navigation";
import { BarChart3, Home, RotateCcw, ShoppingBag, Wallet } from "lucide-react";
import { Dock } from "@/components/ui/dock";

const navItems = [
  { href: "/dashboard", label: "Главная", icon: Home },
  { href: "/orders", label: "Заказы", icon: ShoppingBag },
  { href: "/returns", label: "Возвраты", icon: RotateCcw },
  { href: "/expenses", label: "Расходы", icon: Wallet },
  { href: "/reports", label: "Отчёты", icon: BarChart3 },
];

export function BottomNav() {
  const pathname = usePathname();
  const activeHref = navItems.find((item) => pathname.startsWith(item.href))?.href;

  return (
    <div className="fixed bottom-0 left-0 right-0 z-40 mx-auto max-w-xl pointer-events-none">
      <Dock fullWidth className="pointer-events-auto" items={navItems} activeHref={activeHref} />
    </div>
  );
}
