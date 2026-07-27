"use client";

import { useMemo, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { Archive, Box, CheckCircle2, Package, Search, Warehouse } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { formatDate } from "@/lib/utils";

export interface WarehouseItem {
  id: string;
  productName: string;
  imageUrl: string | null;
  variant: string | null;
  size: string | null;
  trackingNumber: string;
  returnDate: string | null;
  state: "AVAILABLE" | "ARCHIVED";
  sourceOrder: { id: string; orderNumber: string } | null;
  usedByOrder: { id: string; orderNumber: string; isDeleted: boolean } | null;
  archivedAt: string | null;
}

const FILTERS = [
  { value: "AVAILABLE", label: "На складе", icon: Warehouse },
  { value: "ARCHIVED", label: "Архив", icon: Archive },
] as const;

export function WarehouseClient({ items }: { items: WarehouseItem[] }) {
  const [filter, setFilter] = useState<WarehouseItem["state"]>("AVAILABLE");
  const [search, setSearch] = useState("");

  const counts = useMemo(
    () => ({
      AVAILABLE: items.filter((item) => item.state === "AVAILABLE").length,
      ARCHIVED: items.filter((item) => item.state === "ARCHIVED").length,
    }),
    [items],
  );

  const filteredItems = useMemo(() => {
    const query = search.trim().toLocaleLowerCase("ru-RU");
    return items.filter((item) => {
      if (item.state !== filter) return false;
      if (!query) return true;
      return [
        item.productName,
        item.trackingNumber,
        item.variant,
        item.size,
        item.sourceOrder?.orderNumber,
        item.usedByOrder?.orderNumber,
      ].some((value) => value?.toLocaleLowerCase("ru-RU").includes(query));
    });
  }, [filter, items, search]);

  const activeFilter = FILTERS.find((item) => item.value === filter)!;
  const ActiveFilterIcon = activeFilter.icon;

  return (
    <div className="app-shell">
      <div className="app-header">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Склад</h1>
          <p className="section-caption">
            Возвращённые товары до повторной отправки и их архив
          </p>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2">
          {FILTERS.map(({ value, label, icon: Icon }) => (
            <button
              key={value}
              type="button"
              onClick={() => setFilter(value)}
              aria-pressed={filter === value}
              className={`rounded-md border px-2.5 py-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                filter === value
                  ? "border-primary/35 bg-primary/10 text-primary"
                  : "border-border bg-card text-foreground hover:bg-accent/60"
              }`}
            >
              <span className="flex items-center gap-1.5 text-[11px] font-semibold">
                <Icon className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">{label}</span>
              </span>
              <span className="mt-1 block text-lg font-semibold tabular-nums">
                {counts[value]}
              </span>
            </button>
          ))}
        </div>

        <div className="relative mt-3">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Товар, трек или номер заказа"
            aria-label="Поиск по складу"
            className="pl-9"
          />
        </div>
      </div>

      <div className="app-content">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="section-title flex items-center gap-2">
            <ActiveFilterIcon className="h-4 w-4" />
            {activeFilter.label}
          </h2>
          <span className="text-xs font-medium text-muted-foreground">
            {filteredItems.length} шт.
          </span>
        </div>

        <div className="pc-products-grid grid gap-3">
          {filteredItems.map((item) => (
            <Card key={item.id} className="overflow-hidden">
              <CardContent className="p-0">
                <div className="flex min-w-0 gap-3 p-3.5">
                  <div className="h-16 w-16 shrink-0 overflow-hidden rounded-md bg-muted">
                    {item.imageUrl ? (
                      <Image
                        src={item.imageUrl}
                        alt={item.productName}
                        width={64}
                        height={64}
                        unoptimized
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-muted-foreground">
                        <Package className="h-6 w-6" />
                      </div>
                    )}
                  </div>

                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">{item.productName}</p>
                    <p className="mt-0.5 truncate text-xs font-medium text-muted-foreground">
                      {[item.variant, item.size].filter(Boolean).join(" · ") || "Без варианта"}
                    </p>
                    <p className="mt-2 truncate font-mono text-xs text-muted-foreground">
                      {item.trackingNumber}
                    </p>
                  </div>

                  <StateIcon state={item.state} />
                </div>

                <div className="border-t bg-secondary/30 px-3.5 py-2.5 text-xs">
                  <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                    <span className="text-muted-foreground">
                      {item.state === "ARCHIVED"
                        ? `В архиве с ${item.archivedAt ? formatDate(item.archivedAt) : "—"}`
                        : `Возвращён ${item.returnDate ? formatDate(item.returnDate) : "—"}`}
                    </span>
                    <OrderLinks item={item} />
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {filteredItems.length === 0 && (
          <div className="flex min-h-56 flex-col items-center justify-center rounded-lg border border-dashed bg-card/55 px-6 text-center">
            <Box className="mb-3 h-8 w-8 text-muted-foreground" />
            <p className="text-sm font-semibold">
              {search ? "Ничего не найдено" : `Раздел «${activeFilter.label}» пуст`}
            </p>
            <p className="mt-1 max-w-sm text-xs leading-5 text-muted-foreground">
              {filter === "AVAILABLE"
                ? "Здесь появятся возвращённые товары, которые можно использовать в новом заказе."
                : "После выбора складского товара в новом заказе запись автоматически переместится сюда."}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function StateIcon({ state }: { state: WarehouseItem["state"] }) {
  const styles = {
    AVAILABLE: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
    ARCHIVED: "bg-secondary text-muted-foreground",
  };
  const Icon = state === "AVAILABLE" ? CheckCircle2 : Archive;
  return (
    <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-md ${styles[state]}`}>
      <Icon className="h-4 w-4" />
    </span>
  );
}

function OrderLinks({ item }: { item: WarehouseItem }) {
  const source = item.sourceOrder;
  const used = item.usedByOrder;
  return (
    <span className="flex flex-wrap justify-end gap-x-2 gap-y-1 font-semibold">
      {source ? (
        <Link href={`/orders/${source.id}`} className="text-primary hover:underline">
          Возврат из №{source.orderNumber}
        </Link>
      ) : (
        <span className="text-muted-foreground">Ручной возврат</span>
      )}
      {used ? (
        used.isDeleted ? (
          <span className="text-muted-foreground">Использован в №{used.orderNumber}</span>
        ) : (
          <Link href={`/orders/${used.id}`} className="text-primary hover:underline">
            {item.state === "ARCHIVED" ? "Отправлен" : "Заказ"} №{used.orderNumber}
          </Link>
        )
      ) : null}
    </span>
  );
}
