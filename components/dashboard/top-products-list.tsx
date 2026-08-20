"use client";

import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import type { TopProductByOrders } from "@/lib/dashboard/top-products";

const REFRESH_INTERVAL_MS = 60_000;

function formatOrderCount(count: number) {
  const lastTwo = count % 100;
  const last = count % 10;
  if (last === 1 && lastTwo !== 11) return `${count} заказ`;
  if (last >= 2 && last <= 4 && (lastTwo < 12 || lastTwo > 14)) {
    return `${count} заказа`;
  }
  return `${count} заказов`;
}

export function TopProductsList({ initialProducts }: { initialProducts: TopProductByOrders[] }) {
  const [products, setProducts] = useState(initialProducts);

  useEffect(() => {
    let disposed = false;
    let loading = false;

    const refresh = async () => {
      if (loading || document.visibilityState !== "visible") return;
      loading = true;
      try {
        const response = await fetch("/api/dashboard/top-products", { cache: "no-store" });
        if (!response.ok) return;
        const data = await response.json() as { products?: TopProductByOrders[] };
        if (!disposed && Array.isArray(data.products)) setProducts(data.products);
      } catch {
        // Keep the last successful values when the connection is temporarily unavailable.
      } finally {
        loading = false;
      }
    };

    const intervalId = window.setInterval(() => void refresh(), REFRESH_INTERVAL_MS);
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      disposed = true;
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);

  return (
    <Card>
      <CardContent className="p-2">
        {products.map((product, index) => (
          <div key={product.id} className="grid min-w-0 grid-cols-[1.5rem_minmax(0,1fr)_minmax(4.5rem,auto)] items-center gap-2 rounded-md px-2 py-2">
            <span className="flex h-6 w-6 items-center justify-center rounded-md bg-secondary text-xs font-semibold text-muted-foreground">{index + 1}</span>
            <p className="min-w-0 flex-1 truncate text-sm font-medium">{product.name}</p>
            <p className="min-w-0 truncate text-right text-sm font-semibold tabular-nums">
              {formatOrderCount(product.orders)}
            </p>
          </div>
        ))}
        {products.length === 0 && (
          <p className="py-3 text-center text-sm font-medium text-muted-foreground">Нет данных</p>
        )}
      </CardContent>
    </Card>
  );
}
