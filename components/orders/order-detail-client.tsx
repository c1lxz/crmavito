"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import { ArrowLeft, Package } from "lucide-react";
import { detectCarrier } from "@/lib/tracking";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { formatRub, formatDate, formatDateTime } from "@/lib/utils";
import { ORDER_STATUS_LABELS, ORDER_STATUS_COLORS } from "@/lib/constants";
import { toast } from "@/lib/hooks/use-toast";
import type { CalculatedFinancials } from "@/lib/finance/calculations";
import type { OrderStatus } from "@prisma/client";

interface AuditLog {
  id: string;
  fieldName: string;
  oldValue: string | null;
  newValue: string | null;
  timestamp: string;
  user: { name: string };
}

interface OrderDetail {
  id: string;
  orderNumber: string;
  productNameSnapshot: string;
  variant: string | null;
  trackingNumber: string;
  quantity: number;
  salePriceAtOrder: number;
  purchasePricePerUnit: number;
  logisticsCost: number;
  commissionCost: number;
  otherCosts: number;
  status: OrderStatus;
  orderDate: string;
  shippingDate: string | null;
  receivedAt: string | null;
  destinationCity: string | null;
  purchaseComment: string | null;
  createdAt: string;
  updatedAt?: string;
  product: { name: string; imageUrl: string | null };
  counterparty: { name: string; contactInfo: string | null };
  auditLogs: AuditLog[];
}

const FIELD_LABELS: Record<string, string> = {
  status: "Статус",
  trackingNumber: "Трек-номер",
  shippingDate: "Дата отправки",
  quantity: "Количество",
  salePriceAtOrder: "Цена продажи",
  destinationCity: "Город",
  isDeleted: "Удалён",
};

interface Props {
  order: OrderDetail;
  financials: CalculatedFinancials;
  nextStatuses: OrderStatus[];
}

export function OrderDetailClient({ order, financials, nextStatuses }: Props) {
  const router = useRouter();
  const [showStatusDialog, setShowStatusDialog] = useState(false);
  const [selectedStatus, setSelectedStatus] = useState<OrderStatus | null>(null);
  const [shippingDate, setShippingDate] = useState(new Date().toISOString().slice(0, 10));
  const [returnReason, setReturnReason] = useState("");
  const [returnComment, setReturnComment] = useState("");
  const [loading, setLoading] = useState(false);

  function openStatusDialog(status: OrderStatus) {
    setSelectedStatus(status);
    setShowStatusDialog(true);
  }

  async function handleStatusChange() {
    if (!selectedStatus) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/orders/${order.id}/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: selectedStatus,
          shippingDate: selectedStatus === "SHIPPED" ? shippingDate : undefined,
          returnReason: selectedStatus === "RETURNING" ? returnReason : undefined,
          returnComment: selectedStatus === "RETURNING" ? returnComment : undefined,
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error ?? "Ошибка");
      }
      toast({ title: "Статус обновлён", description: `${ORDER_STATUS_LABELS[order.status]} → ${ORDER_STATUS_LABELS[selectedStatus]}` });
      setShowStatusDialog(false);
      router.refresh();
    } catch (err) {
      toast({ title: "Ошибка", description: String(err), variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="app-shell">
      <div className="app-header">
        <div className="flex items-center gap-3">
          <Link href="/orders" className="icon-tile h-9 w-9">
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div className="flex-1">
            <h1 className="font-bold text-lg">№{order.orderNumber}</h1>
            <p className="text-xs text-muted-foreground">{formatDate(order.orderDate)}</p>
          </div>
          <span className={`text-xs px-2 py-1 rounded-full font-medium ${ORDER_STATUS_COLORS[order.status]}`}>
            {ORDER_STATUS_LABELS[order.status]}
          </span>
        </div>
      </div>

      <div className="app-content space-y-4">
        {/* Product */}
        <Card>
          <CardContent className="p-3 flex gap-3">
            <div className="w-16 h-16 rounded-md bg-muted overflow-hidden flex-shrink-0">
              {order.product.imageUrl ? (
                <Image src={order.product.imageUrl} alt={order.productNameSnapshot} width={64} height={64} className="object-cover w-full h-full" />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-muted-foreground">
                  <Package className="h-6 w-6" />
                </div>
              )}
            </div>
            <div>
              <p className="font-semibold">{order.productNameSnapshot}</p>
              {order.variant && <p className="text-sm text-muted-foreground">Цвет: {order.variant}</p>}
              <p className="text-sm text-muted-foreground">{order.quantity} шт. × {formatRub(order.salePriceAtOrder)}</p>
            </div>
          </CardContent>
        </Card>

        {/* Financials */}
        <Card>
          <CardHeader className="p-3 pb-1"><CardTitle className="text-sm">Финансы</CardTitle></CardHeader>
          <CardContent className="p-3 pt-0">
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
              <span className="text-muted-foreground">Выручка:</span><span className="font-medium">{formatRub(financials.revenue)}</span>
              <span className="text-muted-foreground">Себестоимость:</span><span className="font-medium">{formatRub(financials.costOfGoods)}</span>
              <span className="text-muted-foreground">Валовая прибыль:</span><span className="font-medium">{formatRub(financials.grossProfit)}</span>
              <span className="text-muted-foreground">Маржинальность:</span><span className="font-medium">{financials.marginPercent.toFixed(1)}%</span>
              <span className="text-muted-foreground font-medium">Чистая прибыль:</span>
              <span className={`font-bold tabular-nums ${financials.netProfit >= 0 ? "money-positive" : "money-negative"}`}>{formatRub(financials.netProfit)}</span>
            </div>
          </CardContent>
        </Card>

        {/* Logistics */}
        <Card>
          <CardHeader className="p-3 pb-1"><CardTitle className="text-sm">Логистика</CardTitle></CardHeader>
          <CardContent className="p-3 pt-0 space-y-1 text-sm">
            <div className="flex justify-between"><span className="text-muted-foreground">Трек-номер</span><span>{order.trackingNumber}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">ТК</span><span>{detectCarrier(order.trackingNumber)}</span></div>
            {order.trackingNumber && (
              <div className="bg-white rounded-lg border border-border p-2 flex items-center justify-center mt-2">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`/api/barcode?text=${encodeURIComponent(order.trackingNumber)}`} alt="Штрихкод" className="h-20 object-contain" />
              </div>
            )}
            {order.shippingDate && <div className="flex justify-between"><span className="text-muted-foreground">Отправка</span><span>{formatDate(order.shippingDate)}</span></div>}
            {order.receivedAt && <div className="flex justify-between"><span className="text-muted-foreground">Получено</span><span>{formatDate(order.receivedAt)}</span></div>}
            {order.logisticsCost > 0 && <div className="flex justify-between"><span className="text-muted-foreground">Стоимость доставки</span><span>{formatRub(order.logisticsCost)}</span></div>}
            {order.commissionCost > 0 && <div className="flex justify-between"><span className="text-muted-foreground">Комиссия</span><span>{formatRub(order.commissionCost)}</span></div>}
          </CardContent>
        </Card>

        {/* Supplier */}
        <Card>
          <CardHeader className="p-3 pb-1"><CardTitle className="text-sm">Поставщик</CardTitle></CardHeader>
          <CardContent className="p-3 pt-0 space-y-1 text-sm">
            <div className="flex justify-between"><span className="text-muted-foreground">Контрагент</span><span>{order.counterparty.name}</span></div>
            {order.counterparty.contactInfo && <div className="flex justify-between"><span className="text-muted-foreground">Контакт</span><span>{order.counterparty.contactInfo}</span></div>}
            <div className="flex justify-between"><span className="text-muted-foreground">Закупочная цена</span><span>{formatRub(order.purchasePricePerUnit)} × {order.quantity} шт.</span></div>
            {order.purchaseComment && <div className="flex justify-between"><span className="text-muted-foreground">Комментарий</span><span>{order.purchaseComment}</span></div>}
          </CardContent>
        </Card>

        {/* Status change */}
        {nextStatuses.length > 0 && (
          <div className="space-y-2">
            <p className="text-sm font-medium text-muted-foreground">Изменить статус:</p>
            <div className="flex gap-2 flex-wrap">
              {nextStatuses.map((s) => (
                <Button key={s} size="sm" variant="outline" onClick={() => openStatusDialog(s)}>
                  {ORDER_STATUS_LABELS[s]}
                </Button>
              ))}
            </div>
          </div>
        )}

        {/* Audit log */}
        {order.auditLogs.length > 0 && (
          <Card>
            <CardHeader className="p-3 pb-1"><CardTitle className="text-sm">История изменений</CardTitle></CardHeader>
            <CardContent className="p-3 pt-0 space-y-2">
              {order.auditLogs.map((log) => (
                <div key={log.id} className="text-xs border-l border-border pl-3 py-0.5">
                  <p className="text-muted-foreground">{formatDateTime(log.timestamp)} · {log.user.name}</p>
                  <p><span className="font-medium">{FIELD_LABELS[log.fieldName] ?? log.fieldName}:</span>{" "}
                    {log.oldValue && <span className="line-through text-muted-foreground">{log.oldValue}</span>}{" "}
                    → <span className="font-medium">{log.newValue}</span>
                  </p>
                </div>
              ))}
            </CardContent>
          </Card>
        )}
      </div>

      {/* Status change dialog */}
      <Dialog open={showStatusDialog} onOpenChange={(o) => !o && setShowStatusDialog(false)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>
              Перевести в «{selectedStatus ? ORDER_STATUS_LABELS[selectedStatus] : ""}»?
            </DialogTitle>
          </DialogHeader>
          {selectedStatus === "SHIPPED" && (
            <div className="space-y-1">
              <Label>Дата отправки</Label>
              <Input type="date" value={shippingDate} onChange={(e) => setShippingDate(e.target.value)} />
            </div>
          )}
          {selectedStatus === "RETURNING" && (
            <div className="space-y-3">
              <div className="space-y-1">
                <Label>Причина возврата *</Label>
                <Input value={returnReason} onChange={(e) => setReturnReason(e.target.value)} placeholder="Не подошёл размер, брак..." required />
              </div>
              <div className="space-y-1">
                <Label>Комментарий</Label>
                <Textarea value={returnComment} onChange={(e) => setReturnComment(e.target.value)} rows={2} />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowStatusDialog(false)}>Отмена</Button>
            <Button
              onClick={handleStatusChange}
              disabled={loading || (selectedStatus === "RETURNING" && !returnReason)}
            >
              {loading ? "..." : "Подтвердить"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
