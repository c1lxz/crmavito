"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import { ArrowLeft, Download, Maximize2, Package, Pencil, Trash2, X } from "lucide-react";
import { detectCarrierName } from "@/lib/tracking";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatRub, formatDate, formatDateInput, formatDateTime } from "@/lib/utils";
import { ORDER_STATUS_LABELS, ORDER_STATUS_COLORS } from "@/lib/constants";
import { toast } from "@/lib/hooks/use-toast";
import { CreateOrderDialog, type OrderFormInitialValue, type OrderFormProduct } from "./create-order-dialog";
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

interface OrderItem {
  id?: string;
  productId: string;
  productNameSnapshot: string;
  variant: string | null;
  size: string | null;
  quantity: number;
  salePriceAtOrder: number;
  purchasePricePerUnit: number;
  imageUrls: string[];
  sourceReturnId: string | null;
  sourceReturn: { trackingNumber: string } | null;
  product: { name: string; imageUrl: string | null };
}

interface OrderDetail {
  id: string;
  orderNumber: string;
  productId: string;
  counterpartyId: string;
  productNameSnapshot: string;
  variant: string | null;
  size: string | null;
  trackingNumber: string;
  carrier: string | null;
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
  updatedAt: string;
  product: { name: string; imageUrl: string | null };
  counterparty: { name: string; contactInfo: string | null };
  items: OrderItem[];
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
  items: "Товары",
};

const EDITABLE_STATUSES: OrderStatus[] = [
  "ACCEPTED",
  "SHIPPED",
  "RECEIVED",
  "RETURNING",
  "RETURNED",
  "CANCELLED",
];

interface Props {
  order: OrderDetail;
  financials: CalculatedFinancials;
  products: OrderFormProduct[];
  counterparties: { id: string; name: string }[];
}

export function OrderDetailClient({ order, financials, products, counterparties }: Props) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [showBarcode, setShowBarcode] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);
  useEffect(() => {
    if (!showBarcode) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [showBarcode]);

  const barcodeUrl = order.trackingNumber
    ? `/api/barcode?text=${encodeURIComponent(order.trackingNumber)}`
    : null;
  const displayedItems: OrderItem[] =
    order.items.length > 0
      ? order.items
      : [
          {
            productId: order.productId,
            productNameSnapshot: order.productNameSnapshot,
            variant: order.variant,
            size: order.size,
            quantity: order.quantity,
            salePriceAtOrder: order.salePriceAtOrder,
            purchasePricePerUnit: order.purchasePricePerUnit,
            imageUrls: order.product.imageUrl ? [order.product.imageUrl] : [],
            sourceReturnId: null,
            sourceReturn: null,
            product: order.product,
          },
        ];

  const editInitialValue: OrderFormInitialValue = {
    id: order.id,
    counterpartyId: order.counterpartyId,
    purchaseComment: order.purchaseComment ?? "",
    trackingNumber: order.trackingNumber,
    carrier: order.carrier ?? "",
    orderDate: formatDateInput(new Date(order.orderDate)),
    shippingDate: order.shippingDate
      ? formatDateInput(new Date(order.shippingDate))
      : "",
    destinationCity: order.destinationCity ?? "",
    logisticsCost: String(order.logisticsCost),
    commissionCost: String(order.commissionCost),
    otherCosts: String(order.otherCosts),
    items: displayedItems.map((item) => ({
      productId: item.productId,
      productSearch: item.productNameSnapshot,
      variant: item.variant ?? "",
      size: item.size ?? "",
      quantity: item.quantity,
      salePriceAtOrder: String(item.salePriceAtOrder),
      purchasePricePerUnit: String(item.purchasePricePerUnit),
      imageUrls: item.imageUrls.length
        ? item.imageUrls
        : item.product.imageUrl
          ? [item.product.imageUrl]
          : [],
      sourceReturnId: item.sourceReturnId,
    })),
  };

  async function changeStatus(status: OrderStatus) {
    setLoading(true);
    try {
      const response = await fetch(`/api/orders/${order.id}/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status,
          shippingDate: status === "SHIPPED" ? formatDateInput() : undefined,
        }),
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error ?? "Не удалось изменить статус");
      }
      toast({ title: "Статус обновлён", description: ORDER_STATUS_LABELS[status] });
      router.refresh();
    } catch (error) {
      toast({ title: "Ошибка", description: String(error), variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  async function deleteOrder() {
    if (!window.confirm("Удалить заказ? Он будет исключён из всей статистики.")) return;
    setLoading(true);
    try {
      const response = await fetch(`/api/orders/${order.id}`, { method: "DELETE" });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error ?? "Не удалось удалить заказ");
      }
      toast({ title: "Заказ удалён", description: "Данные исключены из статистики" });
      router.push("/orders");
      router.refresh();
    } catch (error) {
      toast({ title: "Ошибка", description: String(error), variant: "destructive" });
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
          <div className="min-w-0 flex-1">
            <h1 className="text-lg font-bold">№{order.orderNumber}</h1>
            <p className="text-xs text-muted-foreground">{formatDate(order.orderDate)}</p>
          </div>
          <Button size="icon" variant="outline" onClick={() => setShowEdit(true)}>
            <Pencil className="h-4 w-4" />
          </Button>
          <Button
            size="icon"
            variant="outline"
            className="text-destructive"
            disabled={loading}
            onClick={() => void deleteOrder()}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="app-content space-y-4">
        <Card>
          <CardHeader className="p-3 pb-1"><CardTitle className="text-sm">Статус заказа</CardTitle></CardHeader>
          <CardContent className="p-3 pt-1">
            <Select
              value={order.status}
              disabled={loading}
              onValueChange={(status) => void changeStatus(status as OrderStatus)}
            >
              <SelectTrigger className={ORDER_STATUS_COLORS[order.status]}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {EDITABLE_STATUSES.map((status) => (
                  <SelectItem key={status} value={status}>
                    {ORDER_STATUS_LABELS[status]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </CardContent>
        </Card>

        <div className="space-y-2">
          {displayedItems.map((item, index) => {
            const photos = item.imageUrls.length
              ? item.imageUrls
              : item.product.imageUrl
                ? [item.product.imageUrl]
                : [];
            return (
              <Card key={item.id ?? `${item.productId}-${index}`}>
                <CardContent className="space-y-3 p-3">
                  <div>
                    <p className="font-semibold">{item.productNameSnapshot}</p>
                    <p className="text-sm text-muted-foreground">
                      {item.variant ? `${item.variant} · ` : ""}
                      {item.size ? `${item.size} · ` : ""}
                      {item.quantity} шт. × {formatRub(item.salePriceAtOrder)}
                    </p>
                    {item.sourceReturn ? (
                      <p className="mt-1 text-xs font-semibold text-emerald-700 dark:text-emerald-300">
                        Взят с депозита · возврат {item.sourceReturn.trackingNumber}
                      </p>
                    ) : null}
                  </div>
                  {photos.length ? (
                    <div className="flex gap-2 overflow-x-auto">
                      {photos.map((photo, photoIndex) => (
                        <div
                          key={`${photo}-${photoIndex}`}
                          className="relative h-24 w-24 shrink-0 overflow-hidden rounded-md bg-muted"
                        >
                          <Image
                            src={photo}
                            alt={`${item.productNameSnapshot}, фото ${photoIndex + 1}`}
                            fill
                            className="object-cover"
                            unoptimized
                          />
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="flex h-20 items-center justify-center rounded-md bg-muted text-muted-foreground">
                      <Package className="h-6 w-6" />
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>

        <Card>
          <CardHeader className="p-3 pb-1"><CardTitle className="text-sm">Финансы</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-2 gap-x-4 gap-y-1 p-3 pt-0 text-sm">
            <span className="text-muted-foreground">Выручка:</span><span>{formatRub(financials.revenue)}</span>
            <span className="text-muted-foreground">Себестоимость:</span><span>{formatRub(financials.costOfGoods)}</span>
            <span className="text-muted-foreground">Валовая прибыль:</span><span>{formatRub(financials.grossProfit)}</span>
            <span className="font-medium text-muted-foreground">Чистая прибыль:</span>
            <span className={financials.netProfit >= 0 ? "money-positive font-bold" : "money-negative font-bold"}>
              {formatRub(financials.netProfit)}
            </span>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="p-3 pb-1"><CardTitle className="text-sm">Логистика</CardTitle></CardHeader>
          <CardContent className="space-y-2 p-3 pt-0 text-sm">
            <div className="flex justify-between"><span className="text-muted-foreground">Трек-номер</span><span>{order.trackingNumber}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">ТК</span><span>{order.carrier || detectCarrierName(order.trackingNumber)}</span></div>
            {barcodeUrl ? (
              <Button type="button" variant="outline" className="w-full gap-2" onClick={() => setShowBarcode(true)}>
                <Maximize2 className="h-4 w-4" />
                Открыть штрихкод
              </Button>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="p-3 pb-1"><CardTitle className="text-sm">Поставщик</CardTitle></CardHeader>
          <CardContent className="space-y-1 p-3 pt-0 text-sm">
            <div className="flex justify-between"><span className="text-muted-foreground">Контрагент</span><span>{order.counterparty.name}</span></div>
            {order.counterparty.contactInfo ? (
              <div className="flex justify-between"><span className="text-muted-foreground">Контакт</span><span>{order.counterparty.contactInfo}</span></div>
            ) : null}
          </CardContent>
        </Card>

        {order.auditLogs.length ? (
          <Card>
            <CardHeader className="p-3 pb-1"><CardTitle className="text-sm">История изменений</CardTitle></CardHeader>
            <CardContent className="space-y-2 p-3 pt-0">
              {order.auditLogs.map((log) => (
                <div key={log.id} className="border-l pl-3 text-xs">
                  <p className="text-muted-foreground">{formatDateTime(log.timestamp)} · {log.user.name}</p>
                  <p><span className="font-medium">{FIELD_LABELS[log.fieldName] ?? log.fieldName}:</span>{" "}
                    {log.oldValue ? <span className="line-through text-muted-foreground">{log.oldValue}</span> : null}
                    {" "}→ <span className="font-medium">{log.newValue}</span>
                  </p>
                </div>
              ))}
            </CardContent>
          </Card>
        ) : null}
      </div>

      <CreateOrderDialog
        open={showEdit}
        onClose={() => setShowEdit(false)}
        products={products}
        counterparties={counterparties}
        initialValue={editInitialValue}
      />

      {mounted && showBarcode && barcodeUrl
        ? createPortal(
            <div className="fixed inset-0 flex flex-col bg-white" style={{ zIndex: 9999 }} role="dialog" aria-modal="true">
              <div className="flex items-center justify-between border-b border-neutral-200 p-4">
                <div>
                  <p className="text-xs text-neutral-500">Заказ №{order.orderNumber}</p>
                  <p className="text-sm font-semibold text-neutral-900">{order.productNameSnapshot}</p>
                </div>
                <button type="button" onClick={() => setShowBarcode(false)} className="rounded-full p-2 text-neutral-700 hover:bg-neutral-100" aria-label="Закрыть">
                  <X className="h-5 w-5" />
                </button>
              </div>
              <div className="flex flex-1 flex-col items-center justify-center gap-6 overflow-auto p-6">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={barcodeUrl} alt="Штрихкод" className="w-full max-w-md object-contain" style={{ imageRendering: "pixelated" }} />
                <div className="text-center">
                  <p className="text-xs uppercase tracking-wider text-neutral-500">Трек-номер</p>
                  <p className="text-2xl font-bold tracking-wide text-neutral-900">{order.trackingNumber}</p>
                  <p className="mt-1 text-sm text-neutral-500">{order.carrier || detectCarrierName(order.trackingNumber)}</p>
                </div>
              </div>
              <div className="flex gap-2 border-t border-neutral-200 p-4">
                <a href={barcodeUrl} download={`barcode-${order.trackingNumber}.png`} className="inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-lg bg-neutral-900 text-sm font-medium text-white">
                  <Download className="h-4 w-4" /> Скачать
                </a>
                <button type="button" onClick={() => setShowBarcode(false)} className="h-11 flex-1 rounded-lg border border-neutral-300 text-sm font-medium text-neutral-900">
                  Закрыть
                </button>
              </div>
            </div>,
            document.body
          )
        : null}
    </div>
  );
}
