"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import Image from "next/image";
import { Plus, Search, ChevronRight, Package, PackageOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatRub, formatDate } from "@/lib/utils";
import { ORDER_STATUS_LABELS, ORDER_STATUS_COLORS } from "@/lib/constants";
import { CreateOrderDialog } from "./create-order-dialog";
import type { OrderStatus } from "@prisma/client";

interface Order {
  id: string;
  orderNumber: string;
  productNameSnapshot: string;
  variant: string | null;
  trackingNumber: string;
  quantity: number;
  status: OrderStatus;
  orderDate: string | Date;
  destinationCity: string | null;
  revenue: number;
  netProfit: number;
  salePriceAtOrder: number;
  purchasePricePerUnit: number;
  logisticsCost: number;
  commissionCost: number;
  otherCosts: number;
  product: { imageUrl: string | null };
  counterparty: { name: string };
}

interface Props {
  initialOrders: Order[];
  counterparties: { id: string; name: string }[];
  products: { id: string; name: string; salePrice: number | string }[];
  totalRevenue: number;
  totalProfit: number;
}

export function OrdersClient({ initialOrders, counterparties, products, totalRevenue, totalProfit }: Props) {
  const [orders] = useState(initialOrders);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [showCreate, setShowCreate] = useState(false);

  const filtered = useMemo(() => {
    return orders.filter((o) => {
      if (statusFilter !== "ALL" && o.status !== statusFilter) return false;
      if (search) {
        const q = search.toLowerCase();
        return (
          o.productNameSnapshot.toLowerCase().includes(q) ||
          o.trackingNumber.toLowerCase().includes(q) ||
          o.orderNumber.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [orders, search, statusFilter]);

  const statuses: Array<{ value: string; label: string }> = [
    { value: "ALL", label: "Все статусы" },
    ...Object.entries(ORDER_STATUS_LABELS).map(([v, l]) => ({ value: v, label: l })),
  ];

  return (
    <div className="app-shell">
      <div className="app-header">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Заказы</h1>
            <p className="section-caption">Всего {filtered.length} из {orders.length}</p>
          </div>
          <Button size="sm" onClick={() => setShowCreate(true)}>
            <Plus className="h-4 w-4" />
            Новый заказ
          </Button>
        </div>
        <div className="px-4 pb-3 space-y-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Поиск по заказам, треку или товару"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
          <div className="flex gap-2 overflow-x-auto pb-1 no-scrollbar">
            {statuses.map((s) => (
              <button
                key={s.value}
                onClick={() => setStatusFilter(s.value)}
                className={`filter-chip ${
                  statusFilter === s.value
                    ? "filter-chip-active"
                    : ""
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="app-content space-y-3">
        <div className="grid grid-cols-3 gap-2">
          <Card>
            <CardContent className="p-3">
              <p className="text-[11px] font-semibold text-muted-foreground">Выручка</p>
              <p className="mt-1 text-sm font-semibold tabular-nums">{formatRub(totalRevenue)}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-3">
              <p className="text-[11px] font-semibold text-muted-foreground">Прибыль</p>
              <p className="mt-1 text-sm font-semibold tabular-nums money-positive">{formatRub(totalProfit)}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-3">
              <p className="text-[11px] font-semibold text-muted-foreground">Позиций</p>
              <p className="mt-1 text-sm font-semibold tabular-nums">{filtered.length}</p>
            </CardContent>
          </Card>
        </div>

        {filtered.map((order) => (
          <Link key={order.id} href={`/orders/${order.id}`} className="block">
            <Card className="transition-colors hover:border-primary/25 hover:bg-accent/45">
              <CardContent className="p-4">
                <div className="flex items-start gap-3">
                  <div className="w-12 h-12 rounded-md bg-muted overflow-hidden flex-shrink-0">
                    {order.product.imageUrl ? (
                      <Image src={order.product.imageUrl} alt={order.productNameSnapshot} width={48} height={48} className="object-cover w-full h-full" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-muted-foreground">
                        <Package className="h-5 w-5" />
                      </div>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs text-muted-foreground">№{order.orderNumber} · {formatDate(order.orderDate)}</span>
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${ORDER_STATUS_COLORS[order.status]}`}>
                        {ORDER_STATUS_LABELS[order.status]}
                      </span>
                    </div>
                    <p className="font-medium text-sm mt-0.5 truncate">{order.productNameSnapshot}</p>
                    {order.variant && <p className="text-xs text-muted-foreground">Цвет: {order.variant}</p>}
                    <div className="flex items-center justify-between mt-1">
                      <div className="text-xs text-muted-foreground">
                        <span>Трек: {order.trackingNumber}</span>
                        <span className="mx-1">·</span>
                        <span>{order.quantity} шт.</span>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-semibold">{formatRub(order.salePriceAtOrder * order.quantity)}</p>
                        <p className="text-xs font-semibold money-positive">+{formatRub(order.netProfit)}</p>
                      </div>
                    </div>
                  </div>
                  <ChevronRight className="h-4 w-4 text-muted-foreground flex-shrink-0 mt-1" />
                </div>
              </CardContent>
            </Card>
          </Link>
        ))}
        {filtered.length === 0 && (
          <div className="text-center text-muted-foreground py-16 flex flex-col items-center gap-3">
            <div className="w-14 h-14 rounded-lg bg-muted flex items-center justify-center">
              <PackageOpen className="h-8 w-8 text-muted-foreground/70" strokeWidth={1.5} />
            </div>
            <p className="text-sm font-medium">Заказов не найдено</p>
          </div>
        )}
      </div>

      <CreateOrderDialog
        open={showCreate}
        onClose={() => setShowCreate(false)}
        counterparties={counterparties}
        products={products.map((p) => ({ ...p, salePrice: typeof p.salePrice === 'string' ? parseFloat(p.salePrice) : p.salePrice }))}
      />
    </div>
  );
}
