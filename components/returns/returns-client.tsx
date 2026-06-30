"use client";

import { useEffect, useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { Package, Plus, RotateCcw, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { formatDate } from "@/lib/utils";
import { RETURN_STATUS_LABELS, RETURN_STATUS_COLORS } from "@/lib/constants";
import { toast } from "@/lib/hooks/use-toast";
import type { ReturnStatus } from "@prisma/client";

interface ReturnItem {
  id: string;
  status: ReturnStatus;
  trackingNumber: string;
  shippingDate: string | null;
  returnDate: string | null;
  reason: string;
  comment: string | null;
  createdAt: string;
  order: { productNameSnapshot: string; variant: string | null; orderNumber: string };
  product: { imageUrl: string | null };
}

interface Props {
  initialData: {
    returns: ReturnItem[];
    totalReturning: number;
    totalReturned: number;
  };
}

const STATUS_TABS: Array<{ value: string; label: string }> = [
  { value: "ALL", label: "Все" },
  { value: "RETURNING", label: "На возврате" },
  { value: "RETURNED", label: "Возвращён" },
  { value: "CANCELLED", label: "Отменён" },
];

export function ReturnsClient({ initialData }: Props) {
  const router = useRouter();
  const [data, setData] = useState(initialData);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  // Sync local state when server props change (router.refresh() after status update).
  useEffect(() => {
    setData(initialData);
  }, [initialData]);

  const filtered = useMemo(() => {
    return data.returns.filter((r) => {
      if (statusFilter !== "ALL" && r.status !== statusFilter) return false;
      if (search) {
        const q = search.toLowerCase();
        return (
          r.trackingNumber.toLowerCase().includes(q) ||
          r.order.productNameSnapshot.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [data.returns, search, statusFilter]);

  async function updateStatus(id: string, status: ReturnStatus, returnDate?: string) {
    setUpdatingId(id);
    try {
      const res = await fetch(`/api/returns/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status, returnDate }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        const message =
          typeof body?.error === "string"
            ? body.error
            : `HTTP ${res.status} — не удалось обновить возврат`;
        throw new Error(message);
      }
      toast({ title: "Статус обновлён" });
      router.refresh();
    } catch (err) {
      toast({
        title: "Ошибка",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    } finally {
      setUpdatingId(null);
    }
  }

  return (
    <div className="app-shell">
      <div className="app-header">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Возвраты</h1>
            <p className="section-caption">Товары в обратной логистике</p>
          </div>
          <Button size="sm" variant="outline" disabled title="Возврат оформляется со страницы заказа">
            <Plus className="h-4 w-4" />
            Оформить возврат
          </Button>
        </div>
        <div className="space-y-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Поиск по треку или товару"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
          <div className="flex gap-2 overflow-x-auto pb-1 no-scrollbar">
            {STATUS_TABS.map((tab) => (
              <button
                key={tab.value}
                onClick={() => setStatusFilter(tab.value)}
                className={`filter-chip ${
                  statusFilter === tab.value
                    ? "filter-chip-active"
                    : ""
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* List */}
      <div className="app-content space-y-3">
        {filtered.map((ret) => (
          <Card key={ret.id}>
            <CardContent className="p-3 space-y-2">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-md bg-muted overflow-hidden flex-shrink-0">
                  {ret.product.imageUrl ? (
                    <Image src={ret.product.imageUrl} alt="" width={40} height={40} className="object-cover w-full h-full" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-muted-foreground">
                      <Package className="h-4 w-4" />
                    </div>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs text-muted-foreground">№{ret.order.orderNumber}</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${RETURN_STATUS_COLORS[ret.status]}`}>
                      {RETURN_STATUS_LABELS[ret.status]}
                    </span>
                  </div>
                  <p className="font-medium text-sm truncate">{ret.order.productNameSnapshot}</p>
                  {ret.order.variant && <p className="text-xs text-muted-foreground">Цвет: {ret.order.variant}</p>}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-x-4 text-xs text-muted-foreground">
                <div>Трек: <span className="text-foreground">{ret.trackingNumber}</span></div>
                {ret.shippingDate && <div>Отправка: <span className="text-foreground">{formatDate(ret.shippingDate)}</span></div>}
                {ret.returnDate && <div>Возврат: <span className="text-foreground">{formatDate(ret.returnDate)}</span></div>}
                <div className="col-span-2">Причина: <span className="text-foreground">{ret.reason}</span></div>
              </div>
              {/* Actions */}
              {ret.status === "RETURNING" && (
                <div className="flex gap-2 pt-1">
                  <Button
                    size="sm"
                    variant="outline"
                    className="flex-1 text-xs"
                    disabled={updatingId === ret.id}
                    onClick={() => updateStatus(ret.id, "RETURNED", new Date().toISOString().slice(0, 10))}
                  >
                    Товар получен
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="flex-1 text-xs text-muted-foreground"
                    disabled={updatingId === ret.id}
                    onClick={() => updateStatus(ret.id, "CANCELLED")}
                  >
                    Отменить возврат
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        ))}
        {filtered.length === 0 && (
          <div className="text-center text-muted-foreground py-12">
            <RotateCcw className="h-10 w-10 mx-auto mb-3 opacity-45" />
            <p className="text-sm font-semibold">Возвратов не найдено</p>
          </div>
        )}
      </div>

      {/* Summary */}
      <div className="px-4 py-3 border-t">
        <div className="flex gap-4 text-sm text-muted-foreground">
          <span>Всего: <strong className="text-foreground">{data.returns.length}</strong></span>
          <span>На возврате: <strong className="text-orange-600">{data.totalReturning}</strong></span>
          <span>Возвращено: <strong className="money-negative">{data.totalReturned}</strong></span>
        </div>
      </div>
    </div>
  );
}
