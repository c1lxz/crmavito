"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import { ExternalLink, ImagePlus, Loader2, Package, Plus, Trash2, Warehouse, X } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { formatDateInput, formatRub, matchesSearch } from "@/lib/utils";
import { detectCarrier, KNOWN_CARRIERS } from "@/lib/tracking";
import { toast } from "@/lib/hooks/use-toast";
import { findWarehouseReturn } from "@/lib/orders/warehouse-match";

export interface OrderFormProduct {
  id: string;
  name: string;
  salePrice: number;
  imageUrl?: string | null;
}

interface Counterparty {
  id: string;
  name: string;
}

interface AvitoProfile {
  id: string;
  name: string;
  color: string | null;
  isActive: boolean;
}

export interface OrderFormItem {
  productId: string;
  productSearch: string;
  variant: string;
  size: string;
  quantity: number;
  salePriceAtOrder: string;
  purchasePricePerUnit: string;
  imageUrls: string[];
  sourceReturnId?: string | null;
  productImageLoading?: boolean;
  productImageError?: string | null;
}

export interface OrderFormInitialValue {
  id: string;
  marketplace: "AVITO" | "WB";
  counterpartyId: string;
  avitoProfileId: string;
  purchaseComment: string;
  trackingNumber: string;
  carrier: string;
  orderDate: string;
  shippingDate: string;
  destinationCity: string;
  logisticsCost: string;
  commissionCost: string;
  otherCosts: string;
  items: OrderFormItem[];
}

interface Props {
  open: boolean;
  onClose: () => void;
  products: OrderFormProduct[];
  counterparties: Counterparty[];
  avitoProfiles: AvitoProfile[];
  initialValue?: OrderFormInitialValue;
  depositedReturns?: DepositedReturn[];
  defaultMarketplace?: "AVITO" | "WB";
}

export interface DepositedReturn {
  id: string;
  productId: string;
  productNameSnapshot: string;
  size: string | null;
  variant: string | null;
  trackingNumber: string;
}

const emptyItem = (): OrderFormItem => ({
  productId: "",
  productSearch: "",
  variant: "",
  size: "",
  quantity: 1,
  salePriceAtOrder: "",
  purchasePricePerUnit: "",
  imageUrls: [],
  sourceReturnId: null,
  productImageError: null,
});

const blankOrderForm = (marketplace: "AVITO" | "WB" = "AVITO") => ({
  marketplace,
  counterpartyId: "",
  avitoProfileId: "",
  purchaseComment: "",
  trackingNumber: "",
  carrier: "",
  orderDate: formatDateInput(),
  shippingDate: "",
  destinationCity: "",
  logisticsCost: "",
  commissionCost: "",
  otherCosts: "",
  items: [emptyItem()],
});

const toMoney = (value: string): number => {
  const number = parseFloat(value.replace(",", "."));
  return Number.isFinite(number) && number >= 0 ? number : 0;
};

export function CreateOrderDialog({
  open,
  onClose,
  products,
  counterparties,
  avitoProfiles,
  initialValue,
  depositedReturns = [],
  defaultMarketplace = "AVITO",
}: Props) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState(() => blankOrderForm(defaultMarketplace));
  const [carrierTouched, setCarrierTouched] = useState(false);
  const [initializedKey, setInitializedKey] = useState<string | null>(null);
  const productsById = useMemo(
    () => new Map(products.map((product) => [product.id, product])),
    [products]
  );
  const isEditing = Boolean(initialValue);

  useEffect(() => {
    if (!open) {
      setInitializedKey(null);
      return;
    }
    const nextKey = initialValue?.id ?? "new";
    if (initializedKey === nextKey) return;
    setForm(
      initialValue
        ? {
            marketplace: initialValue.marketplace,
            counterpartyId: initialValue.counterpartyId,
            avitoProfileId: initialValue.avitoProfileId,
            purchaseComment: initialValue.purchaseComment,
            trackingNumber: initialValue.trackingNumber,
            carrier: initialValue.carrier,
            orderDate: initialValue.orderDate,
            shippingDate: initialValue.shippingDate,
            destinationCity: initialValue.destinationCity,
            logisticsCost: initialValue.logisticsCost,
            commissionCost: initialValue.commissionCost,
            otherCosts: initialValue.otherCosts,
            items: initialValue.items,
          }
        : blankOrderForm(defaultMarketplace)
    );
    setCarrierTouched(Boolean(initialValue?.carrier));
    setInitializedKey(nextKey);
  }, [defaultMarketplace, initialValue, initializedKey, open]);

  function updateItem(index: number, patch: Partial<OrderFormItem>) {
    setForm((current) => ({
      ...current,
      items: current.items.map((item, itemIndex) =>
        itemIndex === index ? { ...item, ...patch } : item
      ),
    }));
  }

  function updateItemWithWarehouse(index: number, patch: Partial<OrderFormItem>) {
    setForm((current) => {
      const currentItem = current.items[index];
      const nextItem = { ...currentItem, ...patch };
      if (isEditing) {
        return {
          ...current,
          items: current.items.map((item, itemIndex) =>
            itemIndex === index ? nextItem : item
          ),
        };
      }

      const excludedIds = new Set(
        current.items.flatMap((item, itemIndex) =>
          itemIndex !== index && item.sourceReturnId ? [item.sourceReturnId] : []
        ),
      );
      const warehouseReturn = findWarehouseReturn(
        depositedReturns,
        nextItem,
        excludedIds,
      );
      const matchedItem = {
        ...nextItem,
        sourceReturnId: warehouseReturn?.id ?? null,
        purchasePricePerUnit: warehouseReturn
          ? "0"
          : currentItem.sourceReturnId
            ? ""
            : nextItem.purchasePricePerUnit,
      };

      return {
        ...current,
        items: current.items.map((item, itemIndex) =>
          itemIndex === index ? matchedItem : item
        ),
      };
    });
  }

  async function fetchProductImage(index: number, productId: string, avitoProfileId = form.avitoProfileId) {
    updateItem(index, { productImageLoading: true, productImageError: null });
    try {
      const response = await fetch(`/api/products/${productId}/fetch-image`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ avitoProfileId: avitoProfileId || null }),
      });
      const data = (await response.json()) as { imageUrl?: string | null; error?: string };
      setForm((current) => ({
        ...current,
        items: current.items.map((item, itemIndex) =>
          itemIndex === index
            ? {
                ...item,
                productImageLoading: false,
                ...(data.imageUrl ? { imageUrls: [data.imageUrl] } : {}),
                productImageError: data.imageUrl ? null : data.error ?? "Фото не найдено",
              }
            : item,
        ),
      }));
    } catch (error) {
      updateItem(index, {
        productImageLoading: false,
        productImageError: String(error).slice(0, 120),
      });
    }
  }

  function selectProduct(index: number, productId: string) {
    const product = productsById.get(productId);
    if (!product) return;
    updateItemWithWarehouse(index, {
      productId,
      productSearch: product.name,
      salePriceAtOrder: String(product.salePrice),
      imageUrls: product.imageUrl ? [product.imageUrl] : [],
      productImageError: null,
    });
    if (!product.imageUrl) void fetchProductImage(index, productId);
  }

  function handleAvitoProfileChange(value: string) {
    const nextProfileId = value === "NONE" ? "" : value;
    setForm((current) => ({
      ...current,
      avitoProfileId: nextProfileId,
    }));
    if (!nextProfileId) return;
    form.items.forEach((item, index) => {
      if (item.productId && item.imageUrls.length === 0) {
        void fetchProductImage(index, item.productId, nextProfileId);
      }
    });
  }

  async function uploadPhotos(index: number, files: FileList | null) {
    if (!files?.length) return;
    const currentCount = form.items[index].imageUrls.length;
    if (currentCount + files.length > 9) {
      toast({ title: "Не больше 9 фото на заказ", variant: "destructive" });
      return;
    }
    updateItem(index, { productImageLoading: true, productImageError: null });
    try {
      const body = new FormData();
      Array.from(files).forEach((file) => body.append("files", file));
      const response = await fetch("/api/uploads", { method: "POST", body });
      const data = (await response.json()) as { urls?: string[]; error?: string };
      if (!response.ok || !data.urls) throw new Error(data.error ?? "Ошибка загрузки");
      setForm((current) => ({
        ...current,
        items: current.items.map((item, itemIndex) =>
          itemIndex === index
            ? {
                ...item,
                imageUrls: [...item.imageUrls, ...data.urls!],
                productImageLoading: false,
              }
            : item
        ),
      }));
    } catch (error) {
      updateItem(index, {
        productImageLoading: false,
        productImageError: String(error),
      });
    }
  }

  function handleTrackingChange(value: string) {
    const detection = value ? detectCarrier(value) : null;
    const detectedCarrier =
      detection?.confidence === "high" ? detection.carrier : "";
    setForm((current) => ({
      ...current,
      trackingNumber: value,
      carrier: carrierTouched ? current.carrier : detectedCarrier,
    }));
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (form.items.some((item) => !item.productId)) {
      toast({ title: "Выберите товар в каждой позиции", variant: "destructive" });
      return;
    }
    setLoading(true);
    try {
      const response = await fetch(
        isEditing ? `/api/orders/${initialValue!.id}` : "/api/orders",
        {
          method: isEditing ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            marketplace: form.marketplace,
            counterpartyId: form.counterpartyId,
            avitoProfileId: form.marketplace === "AVITO" ? form.avitoProfileId || null : null,
            purchaseComment: form.purchaseComment || undefined,
            trackingNumber: form.trackingNumber,
            carrier: form.carrier || undefined,
            orderDate: form.orderDate,
            shippingDate: form.shippingDate || null,
            destinationCity: form.destinationCity || undefined,
            logisticsCost: toMoney(form.logisticsCost),
            commissionCost: toMoney(form.commissionCost),
            otherCosts: toMoney(form.otherCosts),
            items: form.items.map((item) => ({
              productId: item.productId,
              variant: item.variant || undefined,
              size: item.size || undefined,
              quantity: item.quantity,
              salePriceAtOrder: toMoney(item.salePriceAtOrder),
              purchasePricePerUnit: toMoney(item.purchasePricePerUnit),
              imageUrls: item.imageUrls,
              sourceReturnId: item.sourceReturnId ?? null,
            })),
          }),
        }
      );
      if (!response.ok) {
        const error = await response.json();
        throw new Error(
          typeof error.error === "string" ? error.error : "Проверьте заполненные поля"
        );
      }
      toast({ title: isEditing ? "Заказ обновлён" : "Заказ создан" });
      onClose();
      router.refresh();
    } catch (error) {
      toast({ title: "Ошибка", description: String(error), variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  const totalRevenue = form.items.reduce(
    (sum, item) => sum + toMoney(item.salePriceAtOrder) * item.quantity,
    0
  );

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && onClose()}>
      <DialogContent className="flex h-[calc(100dvh-var(--app-top-pad,48px)-var(--app-bottom-pad,0px)-1rem)] max-w-lg flex-col overflow-hidden p-0 sm:h-[min(760px,calc(100dvh-var(--app-top-pad,48px)-var(--app-bottom-pad,0px)-2rem))]">
        <DialogHeader className="shrink-0 border-b border-border/70 px-4 py-4 pr-14 text-left">
          <DialogTitle>
            {isEditing
              ? "Редактирование заказа"
              : form.marketplace === "WB"
                ? "Новый заказ WB"
                : "Новый заказ Авито"}
          </DialogTitle>
        </DialogHeader>
        <form
          onSubmit={handleSubmit}
          className="flex min-h-0 flex-1 flex-col"
        >
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain scroll-pb-24 px-4 py-3">
            {form.items.map((item, index) => {
              const selectedProduct = productsById.get(item.productId);
              const matches =
                item.productSearch.trim() && selectedProduct?.name !== item.productSearch
                  ? products
                      .filter((product) => matchesSearch(product.name, item.productSearch))
                      .slice(0, 50)
                  : [];
              const warehouseReturn = item.sourceReturnId
                ? depositedReturns.find((returnedItem) => returnedItem.id === item.sourceReturnId)
                : null;
              return (
                <section
                  key={index}
                  className="space-y-3 rounded-lg border border-border/70 bg-background/35 p-3"
                >
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold">Товар {index + 1}</h3>
                    {form.items.length > 1 ? (
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        onClick={() =>
                          setForm((current) => ({
                            ...current,
                            items: current.items.filter((_, itemIndex) => itemIndex !== index),
                          }))
                        }
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    ) : null}
                  </div>
                  <div className="space-y-1">
                    <Label>Поиск товара</Label>
                    <Input
                      value={item.productSearch}
                      placeholder="Начните вводить название..."
                      onChange={(event) =>
                        updateItemWithWarehouse(index, {
                          productSearch: event.target.value,
                          ...(event.target.value !== selectedProduct?.name
                            ? { productId: "", imageUrls: [] }
                            : {}),
                        })
                      }
                    />
                    {matches.length > 0 ? (
                      <div className="max-h-48 overflow-y-auto rounded-md border bg-card">
                        {matches.map((product) => (
                          <button
                            key={product.id}
                            type="button"
                            className="flex w-full justify-between px-3 py-2 text-left text-sm hover:bg-secondary"
                            onClick={() => selectProduct(index, product.id)}
                          >
                            <span>{product.name}</span>
                            <span className="text-muted-foreground">
                              {formatRub(product.salePrice)}
                            </span>
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <Label>Цвет / вариант</Label>
                      <Input
                        value={item.variant}
                        onChange={(event) =>
                          updateItemWithWarehouse(index, { variant: event.target.value })
                        }
                      />
                    </div>
                    <div className="space-y-1">
                      <Label>Размер</Label>
                      <Input
                        value={item.size}
                        onChange={(event) =>
                          updateItemWithWarehouse(index, {
                            size: event.target.value,
                          })
                        }
                      />
                    </div>
                    <div className="space-y-1">
                      <Label>Количество</Label>
                      <Input
                        type="number"
                        min={1}
                        value={item.quantity}
                        onChange={(event) =>
                          updateItemWithWarehouse(index, {
                            quantity: Math.max(1, Number(event.target.value)),
                          })
                        }
                      />
                    </div>
                    <div className="space-y-1">
                      <Label>Цена продажи, ₽</Label>
                      <Input
                        type="number"
                        min={0.01}
                        step="0.01"
                        required
                        value={item.salePriceAtOrder}
                        onChange={(event) =>
                          updateItem(index, { salePriceAtOrder: event.target.value })
                        }
                      />
                    </div>
                  </div>
                  {warehouseReturn ? (
                    <div className="space-y-2 rounded-md border border-success/30 bg-success/10 p-3">
                      <div className="flex items-center gap-2 text-sm font-semibold text-success">
                        <Warehouse className="h-4 w-4" />
                        Есть на складе
                      </div>
                      <p className="text-xs text-success/85">
                        Возврат {warehouseReturn.trackingNumber} будет использован автоматически.
                      </p>
                    </div>
                  ) : null}
                  <div className="space-y-1">
                    <Label>Закупочная цена за единицу, ₽</Label>
                    <Input
                      type="number"
                      min={0}
                      step="0.01"
                      required
                      disabled={Boolean(item.sourceReturnId)}
                      value={item.purchasePricePerUnit}
                      onChange={(event) =>
                        updateItem(index, { purchasePricePerUnit: event.target.value })
                      }
                    />
                  </div>

                  <div className="space-y-2">
                    <Label>Фото товара</Label>
                    <div className="flex flex-wrap gap-2">
                      {item.imageUrls.map((url, photoIndex) => (
                        <div
                          key={`${url}-${photoIndex}`}
                          className="group relative h-20 w-20 overflow-hidden rounded-md border bg-muted"
                        >
                          <Image
                            src={url}
                            alt={`Фото ${photoIndex + 1}`}
                            fill
                            className="object-cover"
                            unoptimized
                          />
                          <button
                            type="button"
                            aria-label={`Удалить фото ${photoIndex + 1}`}
                            className="absolute right-1 top-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-black/75 p-0 text-white shadow-sm"
                            onClick={() =>
                              updateItem(index, {
                                imageUrls: item.imageUrls.filter(
                                  (_, imageIndex) => imageIndex !== photoIndex
                                ),
                              })
                            }
                          >
                            <X className="h-4 w-4" aria-hidden />
                          </button>
                        </div>
                      ))}
                      <label className="flex h-20 w-20 cursor-pointer flex-col items-center justify-center rounded-md border border-dashed text-xs text-muted-foreground hover:bg-muted/50">
                        {item.productImageLoading ? (
                          <Loader2 className="h-5 w-5 animate-spin" />
                        ) : (
                          <ImagePlus className="mb-1 h-5 w-5" />
                        )}
                        Добавить
                        <input
                          type="file"
                          accept="image/jpeg,image/png,image/webp,image/gif"
                          multiple
                          className="sr-only"
                          onChange={(event) => void uploadPhotos(index, event.target.files)}
                        />
                      </label>
                    </div>
                    {item.productImageError ? (
                      <p className="text-xs text-destructive">{item.productImageError}</p>
                    ) : null}
                    {item.productId && item.imageUrls.length === 0 ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => void fetchProductImage(index, item.productId)}
                      >
                        <Package className="h-4 w-4" />
                        Повторить импорт из Avito
                      </Button>
                    ) : null}
                  </div>
                </section>
              );
            })}

            <Button
              type="button"
              variant="outline"
              className="w-full"
              disabled={form.items.length >= 9}
              onClick={() =>
                setForm((current) => ({ ...current, items: [...current.items, emptyItem()] }))
              }
            >
              <Plus className="h-4 w-4" />
              Добавить товар
            </Button>

            <section className="space-y-3 rounded-lg border p-3">
              <h3 className="text-sm font-semibold">Заказ и доставка</h3>
              <div className="space-y-1">
                <Label>Контрагент</Label>
                <Select
                  value={form.counterpartyId}
                  onValueChange={(value) =>
                    setForm((current) => ({ ...current, counterpartyId: value }))
                  }
                  required
                >
                  <SelectTrigger><SelectValue placeholder="Выберите контрагента" /></SelectTrigger>
                  <SelectContent>
                    {counterparties.map((counterparty) => (
                      <SelectItem key={counterparty.id} value={counterparty.id}>
                        {counterparty.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Link
                  href="/counterparties"
                  className="inline-flex items-center gap-1 text-xs text-primary"
                >
                  Справочник контрагентов <ExternalLink className="h-3 w-3" />
                </Link>
              </div>
              {form.marketplace === "AVITO" ? (
              <div className="space-y-1">
                <Label>Профиль Avito</Label>
                <Select
                  value={form.avitoProfileId || "NONE"}
                  onValueChange={handleAvitoProfileChange}
                >
                  <SelectTrigger><SelectValue placeholder="Выберите профиль" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="NONE">Не указан</SelectItem>
                    {avitoProfiles
                      .filter((profile) => profile.isActive || profile.id === form.avitoProfileId)
                      .map((profile) => (
                        <SelectItem key={profile.id} value={profile.id}>
                          {profile.name}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
              ) : (
                <div className="rounded-md border border-special/25 bg-special/8 px-3 py-2 text-xs text-muted-foreground">
                  Заказ будет учтён в статистике Wildberries.
                </div>
              )}
              <div className="space-y-1">
                <Label>
                  {form.marketplace === "WB"
                    ? "ID сборочного задания WB"
                    : "Трек-номер / штрихкод"}
                </Label>
                <Input
                  required
                  inputMode={form.marketplace === "WB" ? "numeric" : undefined}
                  pattern={form.marketplace === "WB" ? "[0-9]{1,20}" : undefined}
                  value={form.trackingNumber}
                  onChange={(event) => handleTrackingChange(event.target.value)}
                />
                {form.marketplace === "WB" ? (
                  <p className="text-xs text-muted-foreground">
                    По этому ID WB сформирует QR-код стикера для Telegram-группы.
                  </p>
                ) : null}
              </div>
              <div className="space-y-1">
                <Label>Транспортная компания</Label>
                <Select
                  value={form.carrier || "OTHER"}
                  onValueChange={(value) => {
                    setCarrierTouched(true);
                    setForm((current) => ({
                      ...current,
                      carrier: value === "OTHER" ? "" : value,
                    }));
                  }}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {KNOWN_CARRIERS.map((carrier) => (
                      <SelectItem key={carrier} value={carrier}>{carrier}</SelectItem>
                    ))}
                    <SelectItem value="OTHER">Другая / не указана</SelectItem>
                  </SelectContent>
                </Select>
                {!KNOWN_CARRIERS.includes(form.carrier as (typeof KNOWN_CARRIERS)[number]) ? (
                  <Input
                    placeholder="Название транспортной компании"
                    value={form.carrier}
                    onChange={(event) =>
                      setForm((current) => ({ ...current, carrier: event.target.value }))
                    }
                  />
                ) : null}
              </div>
              <div className={isEditing ? "grid grid-cols-2 gap-2" : undefined}>
                <div className="space-y-1">
                  <Label>Дата заказа</Label>
                  <Input
                    type="date"
                    required
                    value={form.orderDate}
                    onChange={(event) =>
                      setForm((current) => ({ ...current, orderDate: event.target.value }))
                    }
                  />
                </div>
                {isEditing ? (
                  <div className="space-y-1">
                    <Label>Дата отправки</Label>
                    <Input
                      type="date"
                      value={form.shippingDate}
                      onChange={(event) =>
                        setForm((current) => ({ ...current, shippingDate: event.target.value }))
                      }
                    />
                  </div>
                ) : null}
              </div>
              {isEditing ? (
                <Input
                  placeholder="Город назначения"
                  value={form.destinationCity}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, destinationCity: event.target.value }))
                  }
                />
              ) : null}
              <Textarea
                placeholder="Комментарий к закупке"
                value={form.purchaseComment}
                onChange={(event) =>
                  setForm((current) => ({ ...current, purchaseComment: event.target.value }))
                }
              />
            </section>

            <section className="space-y-3 rounded-lg border p-3">
              <h3 className="text-sm font-semibold">Дополнительные расходы</h3>
              {[
                ["logisticsCost", "Логистика, ₽"],
                ["commissionCost", "Комиссия, ₽"],
                ["otherCosts", "Прочее, ₽"],
              ].map(([key, label]) => (
                <div className="space-y-1" key={key}>
                  <Label>{label}</Label>
                  <Input
                    type="number"
                    min={0}
                    step="0.01"
                    value={form[key as keyof typeof form] as string}
                    onChange={(event) =>
                      setForm((current) => ({ ...current, [key]: event.target.value }))
                    }
                  />
                </div>
              ))}
              <p className="text-sm font-semibold">
                Выручка заказа: {formatRub(totalRevenue)}
              </p>
            </section>
          </div>
          <div className="shrink-0 border-t bg-background p-4">
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {isEditing ? "Сохранить изменения" : "Создать заказ"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
