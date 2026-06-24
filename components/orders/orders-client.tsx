"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import Image from "next/image";
import { Plus, Search, Filter, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
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
  destinationCity: string;
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
    <div className="bg-background min-h-screen">
      {/* Header */}
      <div className="sticky top-0 z-30 bg-background/95 backdrop-blur-sm border-b">
        <div className="flex items-center justify-between px-4 pt-12 pb-3">
          <h1 className="text-xl font-bold">Заказы</h1>
          <Button size="sm" onClick={() => setShowCreate(true)}>
            <Plus className="h-4 w-4" />
            Новый заказ
          </Button>
        </div>
        {/* Search */}
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
                className={`px-3 py-1 rounded-full text-xs whitespace-nowrap font-medium transition-colors ${
                  statusFilter === s.value
                    ? "bg-primary text-primary-foreground"
                    : "bg-secondary text-secondary-foreground hover:bg-secondary/80"
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Orders list */}
      <div className="px-4 py-3 space-y-2">
        {filtered.map((order) => (
          <Link key={order.id} href={`/orders/${order.id}`}>
            <Card className="hover:shadow-md transition-shadow">
              <CardContent className="p-3">
                <div className="flex items-start gap-3">
                  <div className="w-12 h-12 rounded-lg bg-muted overflow-hidden flex-shrink-0">
                    {order.product.imageUrl ? (
                      <Image src={order.product.imageUrl} alt={order.productNameSnapshot} width={48} height={48} className="object-cover w-full h-full" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-muted-foreground text-lg">📦</div>
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
                        <p className="text-xs text-emerald-600">+{formatRub(order.netProfit)}</p>
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
          <div className="text-center text-muted-foreground py-12">
            <p className="text-4xl mb-2">📦</p>
            <p>Заказов не найдено</p>
          </div>
        )}
      </div>

      {/* Summary */}
      <div className="fixed bottom-16 left-0 right-0 max-w-lg mx-auto px-4">
        <Card className="shadow-lg border">
          <CardContent className="p-3 flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Всего: <strong className="text-foreground">{filtered.length}</strong></span>
            <span className="text-muted-foreground">На сумму: <strong className="text-foreground">{formatRub(totalRevenue)}</strong></span>
            <span className="text-muted-foreground">Прибыль: <strong className="text-emerald-600">{formatRub(totalProfit)}</strong></span>
          </CardContent>
        </Card>
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
