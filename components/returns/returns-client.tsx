"use client";

import { useEffect, useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { Loader2, Package, Plus, RotateCcw, Search, Warehouse } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { formatDate, formatDateInput } from "@/lib/utils";
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
  productNameSnapshot: string;
  variant: string | null;
  size: string | null;
  createdAt: string;
  order: { productNameSnapshot: string; variant: string | null; orderNumber: string } | null;
  product: { imageUrl: string | null };
  usedByOrderItems: Array<{ order: { orderNumber: string } }>;
}

interface Props {
  initialData: {
    returns: ReturnItem[];
    totalReturning: number;
    totalReturned: number;
    products: Array<{ id: string; name: string; imageUrl: string | null }>;
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
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [lookingUp, setLookingUp] = useState(false);
  const [returnForm, setReturnForm] = useState({
    trackingNumber: "",
    productId: "",
    productNameSnapshot: "",
    variant: "",
    size: "",
    shippingDate: formatDateInput(),
    reason: "",
    comment: "",
    matchedOrder: "",
  });

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
          r.productNameSnapshot.toLowerCase().includes(q)
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

  async function lookupOrder(trackingNumber: string) {
    const tracking = trackingNumber.trim();
    if (!tracking) return;
    setLookingUp(true);
    try {
      const response = await fetch(
        `/api/orders?tracking=${encodeURIComponent(tracking)}&pageSize=10`,
      );
      const body = await response.json();
      const order = body.orders?.find(
        (candidate: { trackingNumber: string }) =>
          candidate.trackingNumber.toLowerCase() === tracking.toLowerCase(),
      );
      if (!order) {
        setReturnForm((current) => ({ ...current, matchedOrder: "" }));
        return;
      }
      const item = order.items?.[0];
      setReturnForm((current) => ({
        ...current,
        productId: item?.productId ?? order.productId,
        productNameSnapshot:
          item?.productNameSnapshot ?? order.productNameSnapshot,
        variant: item?.variant ?? order.variant ?? "",
        size: item?.size ?? order.size ?? "",
        matchedOrder: order.orderNumber,
      }));
    } catch {
      // If lookup is unavailable, the user can still fill the return manually.
    } finally {
      setLookingUp(false);
    }
  }

  async function createReturn(event: React.FormEvent) {
    event.preventDefault();
    setCreating(true);
    try {
      const response = await fetch("/api/returns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          trackingNumber: returnForm.trackingNumber,
          productId: returnForm.productId,
          productNameSnapshot: returnForm.productNameSnapshot,
          variant: returnForm.variant || undefined,
          size: returnForm.size || undefined,
          shippingDate: returnForm.shippingDate || null,
          reason: returnForm.reason,
          comment: returnForm.comment || undefined,
        }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(
          typeof body?.error === "string"
            ? body.error
            : "Проверьте заполненные поля",
        );
      }
      toast({ title: "Возврат оформлен" });
      setShowCreate(false);
      setReturnForm({
        trackingNumber: "",
        productId: "",
        productNameSnapshot: "",
        variant: "",
        size: "",
        shippingDate: formatDateInput(),
        reason: "",
        comment: "",
        matchedOrder: "",
      });
      router.refresh();
    } catch (error) {
      toast({
        title: "Не удалось оформить возврат",
        description: error instanceof Error ? error.message : String(error),
        variant: "destructive",
      });
    } finally {
      setCreating(false);
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
          <Button size="sm" variant="outline" onClick={() => setShowCreate(true)}>
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
                    <span className="text-xs text-muted-foreground">
                      {ret.order ? `№${ret.order.orderNumber}` : "Ручной возврат"}
                    </span>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${RETURN_STATUS_COLORS[ret.status]}`}>
                      {RETURN_STATUS_LABELS[ret.status]}
                    </span>
                  </div>
                  <p className="font-medium text-sm truncate">{ret.productNameSnapshot}</p>
                  {ret.variant && <p className="text-xs text-muted-foreground">Цвет: {ret.variant}</p>}
                  {ret.size && <p className="text-xs text-muted-foreground">Размер: {ret.size}</p>}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-x-4 text-xs text-muted-foreground">
                <div>Трек: <span className="text-foreground">{ret.trackingNumber}</span></div>
                {ret.shippingDate && <div>Отправка: <span className="text-foreground">{formatDate(ret.shippingDate)}</span></div>}
                {ret.returnDate && <div>Возврат: <span className="text-foreground">{formatDate(ret.returnDate)}</span></div>}
                <div className="col-span-2">Причина: <span className="text-foreground">{ret.reason}</span></div>
                {ret.usedByOrderItems[0] ? (
                  <div className="col-span-2 mt-1 flex items-center gap-1 font-semibold text-emerald-700 dark:text-emerald-300">
                    <Warehouse className="h-3.5 w-3.5" />
                    Взят с депозита в заказ №{ret.usedByOrderItems[0].order.orderNumber}
                  </div>
                ) : null}
              </div>
              {/* Actions */}
              {ret.status === "RETURNING" && (
                <div className="flex gap-2 pt-1">
                  <Button
                    size="sm"
                    variant="outline"
                    className="flex-1 text-xs"
                    disabled={updatingId === ret.id}
                    onClick={() => updateStatus(ret.id, "RETURNED", formatDateInput())}
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

      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="max-h-[85dvh] max-w-lg overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Оформить возврат</DialogTitle>
          </DialogHeader>
          <form className="space-y-3" onSubmit={createReturn}>
            <div className="space-y-1">
              <Label>Трек-номер возврата</Label>
              <div className="flex gap-2">
                <Input
                  required
                  value={returnForm.trackingNumber}
                  onChange={(event) =>
                    setReturnForm((current) => ({
                      ...current,
                      trackingNumber: event.target.value,
                      matchedOrder: "",
                    }))
                  }
                  onBlur={(event) => void lookupOrder(event.target.value)}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  disabled={lookingUp}
                  onClick={() => void lookupOrder(returnForm.trackingNumber)}
                  aria-label="Найти заказ по трек-номеру"
                >
                  {lookingUp ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Search className="h-4 w-4" />
                  )}
                </Button>
              </div>
              {returnForm.matchedOrder ? (
                <p className="text-xs font-semibold text-emerald-700 dark:text-emerald-300">
                  Найден заказ №{returnForm.matchedOrder}, данные подставлены
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Если заказа нет, заполните данные вручную
                </p>
              )}
            </div>
            <div className="space-y-1">
              <Label>Товар</Label>
              <Select
                required
                value={returnForm.productId}
                onValueChange={(productId) => {
                  const product = data.products.find((item) => item.id === productId);
                  setReturnForm((current) => ({
                    ...current,
                    productId,
                    productNameSnapshot: product?.name ?? "",
                    matchedOrder: "",
                  }));
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Выберите товар" />
                </SelectTrigger>
                <SelectContent>
                  {data.products.map((product) => (
                    <SelectItem key={product.id} value={product.id}>
                      {product.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label>Цвет / вариант</Label>
                <Input
                  value={returnForm.variant}
                  onChange={(event) =>
                    setReturnForm((current) => ({ ...current, variant: event.target.value }))
                  }
                />
              </div>
              <div className="space-y-1">
                <Label>Размер</Label>
                <Input
                  value={returnForm.size}
                  onChange={(event) =>
                    setReturnForm((current) => ({ ...current, size: event.target.value }))
                  }
                />
              </div>
            </div>
            <div className="space-y-1">
              <Label>Дата отправки покупателем</Label>
              <Input
                type="date"
                value={returnForm.shippingDate}
                onChange={(event) =>
                  setReturnForm((current) => ({
                    ...current,
                    shippingDate: event.target.value,
                  }))
                }
              />
            </div>
            <div className="space-y-1">
              <Label>Причина</Label>
              <Input
                required
                value={returnForm.reason}
                onChange={(event) =>
                  setReturnForm((current) => ({ ...current, reason: event.target.value }))
                }
              />
            </div>
            <div className="space-y-1">
              <Label>Комментарий</Label>
              <Textarea
                value={returnForm.comment}
                onChange={(event) =>
                  setReturnForm((current) => ({ ...current, comment: event.target.value }))
                }
              />
            </div>
            <Button
              className="w-full"
              type="submit"
              disabled={
                creating ||
                !returnForm.productId ||
                !returnForm.productNameSnapshot
              }
            >
              {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Оформить возврат
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
