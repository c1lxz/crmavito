"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { Loader2, Package, Plus, X } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { formatRub, matchesSearch } from "@/lib/utils";
import { calcOrderFinancials } from "@/lib/finance/calculations";
import { detectCarrier } from "@/lib/tracking";
import { toast } from "@/lib/hooks/use-toast";

interface Product { id: string; name: string; salePrice: number; imageUrl?: string | null; }
interface Counterparty { id: string; name: string; }

interface Props {
  open: boolean;
  onClose: () => void;
  products: Product[];
  counterparties: Counterparty[];
}

export function CreateOrderDialog({ open, onClose, products, counterparties: initialCounterparties }: Props) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [counterparties, setCounterparties] = useState<Counterparty[]>(initialCounterparties);
  const [showAddCp, setShowAddCp] = useState(false);
  const [newCp, setNewCp] = useState({ name: "", contactInfo: "" });
  const [cpLoading, setCpLoading] = useState(false);
  const [form, setForm] = useState({
    productId: "",
    variant: "",
    size: "",
    quantity: 1,
    salePriceAtOrder: "",
    counterpartyId: "",
    purchasePricePerUnit: "",
    purchaseComment: "",
    trackingNumber: "",
    carrier: "",
    orderDate: new Date().toISOString().slice(0, 10),
    logisticsCost: "",
    commissionCost: "",
    otherCosts: "",
  });
  const [productSearch, setProductSearch] = useState("");
  const [productImageUrl, setProductImageUrl] = useState<string | null>(null);
  const [productImageLoading, setProductImageLoading] = useState(false);
  const [productImageError, setProductImageError] = useState<string | null>(null);
  const [carrierTouched, setCarrierTouched] = useState(false);

  useEffect(() => {
    setCounterparties(initialCounterparties);
  }, [initialCounterparties]);

  async function handleCreateCounterparty() {
    if (!newCp.name.trim()) return;
    setCpLoading(true);
    try {
      const res = await fetch("/api/counterparties", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newCp.name.trim(),
          contactInfo: newCp.contactInfo.trim() || undefined,
        }),
      });
      if (!res.ok) throw new Error("Ошибка создания контрагента");
      const cp = (await res.json()) as Counterparty;
      setCounterparties((prev) => [...prev, { id: cp.id, name: cp.name }].sort((a, b) => a.name.localeCompare(b.name)));
      setForm((f) => ({ ...f, counterpartyId: cp.id }));
      setNewCp({ name: "", contactInfo: "" });
      setShowAddCp(false);
      toast({ title: "Контрагент создан" });
      router.refresh();
    } catch (e) {
      toast({ title: "Ошибка", description: String(e), variant: "destructive" });
    } finally {
      setCpLoading(false);
    }
  }

  const selectedProduct = products.find((p) => p.id === form.productId);
  const filteredProducts = products.filter((p) => matchesSearch(p.name, productSearch));

  const detectedCarrier = form.trackingNumber ? detectCarrier(form.trackingNumber) : "";
  const showProductResults = Boolean(productSearch.trim()) && selectedProduct?.name !== productSearch;
  const barcodeUrl = form.trackingNumber
    ? `/api/barcode?text=${encodeURIComponent(form.trackingNumber)}`
    : null;

  async function fetchProductImage(productId: string) {
    setProductImageLoading(true);
    setProductImageError(null);
    try {
      const res = await fetch(`/api/products/${productId}/fetch-image`, { method: "POST" });
      const data = (await res.json()) as { imageUrl?: string | null; error?: string };
      if (data.imageUrl) {
        setProductImageUrl(data.imageUrl);
      } else {
        setProductImageError(data.error ?? "Фото не найдено");
      }
    } catch (e) {
      setProductImageError(String(e).slice(0, 120));
    } finally {
      setProductImageLoading(false);
    }
  }

  function handleProductSelect(id: string) {
    const p = products.find((x) => x.id === id);
    if (p) {
      setForm((f) => ({ ...f, productId: id, salePriceAtOrder: String(p.salePrice) }));
      setProductSearch(p.name);
      setProductImageError(null);
      if (p.imageUrl) {
        setProductImageUrl(p.imageUrl);
      } else {
        setProductImageUrl(null);
        fetchProductImage(id);
      }
    }
  }

  function handleProductSearchChange(value: string) {
    setProductSearch(value);
    if (form.productId && selectedProduct?.name !== value) {
      setForm((f) => ({ ...f, productId: "" }));
      setProductImageUrl(null);
      setProductImageError(null);
    }
  }

  function handleTrackingChange(value: string) {
    const nextCarrier = value ? detectCarrier(value) : "";
    setForm((f) => ({
      ...f,
      trackingNumber: value,
      carrier: carrierTouched ? f.carrier : nextCarrier,
    }));
  }

  const toMoney = (v: string): number => {
    const n = parseFloat(v.replace(",", "."));
    return Number.isFinite(n) && n >= 0 ? n : 0;
  };

  const preview = calcOrderFinancials({
    salePriceAtOrder: toMoney(form.salePriceAtOrder),
    quantity: form.quantity,
    purchasePricePerUnit: toMoney(form.purchasePricePerUnit),
    logisticsCost: toMoney(form.logisticsCost),
    commissionCost: toMoney(form.commissionCost),
    otherCosts: toMoney(form.otherCosts),
  });

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          salePriceAtOrder: toMoney(form.salePriceAtOrder),
          purchasePricePerUnit: toMoney(form.purchasePricePerUnit),
          logisticsCost: toMoney(form.logisticsCost),
          commissionCost: toMoney(form.commissionCost),
          otherCosts: toMoney(form.otherCosts),
          carrier: form.carrier.trim() || undefined,
          productImageUrl: productImageUrl?.trim() || undefined,
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error?.message ?? "Ошибка создания заказа");
      }
      toast({ title: "Заказ создан", description: "Заказ успешно добавлен в систему" });
      onClose();
      router.refresh();
    } catch (err) {
      toast({ title: "Ошибка", description: String(err), variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92svh] max-w-md overflow-hidden p-0">
        <DialogHeader className="border-b border-border/70 px-4 py-4 pr-12 text-left">
          <DialogTitle className="text-lg">Новый заказ</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex max-h-[calc(92svh-61px)] min-h-0 flex-col">
          <div className="min-h-0 space-y-3 overflow-y-auto px-4 pb-4 pt-3">
            {/* Товар */}
            <div className="space-y-3 rounded-lg border border-border/70 bg-background/35 p-3">
            <h3 className="text-sm font-semibold">Товар</h3>
            <div className="space-y-1">
              <Label>Поиск товара</Label>
              <Input
                placeholder="Начните вводить название..."
                value={productSearch}
                onChange={(e) => handleProductSearchChange(e.target.value)}
              />
              {showProductResults && (
                <div className="max-h-56 overflow-y-auto overscroll-contain rounded-md border border-border/80 bg-card">
                  {filteredProducts.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      className="w-full px-3 py-2 text-left text-sm hover:bg-secondary"
                      onClick={() => handleProductSelect(p.id)}
                    >
                      <span>{p.name}</span>
                      <span className="text-muted-foreground ml-2">{formatRub(p.salePrice)}</span>
                    </button>
                  ))}
                  {filteredProducts.length === 0 && (
                    <div className="px-3 py-2 text-sm text-muted-foreground">
                      <p className="font-medium">Товар не найден</p>
                      <p className="mt-0.5 text-xs">Проверьте раздел «Все товары» — возможно, нужна синхронизация с Avito.</p>
                    </div>
                  )}
                </div>
              )}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label>Цвет / вариант</Label>
                <Input placeholder="Белый, Чёрный..." value={form.variant} onChange={(e) => setForm((f) => ({ ...f, variant: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <Label>Размер</Label>
                <Input placeholder="XL, 42, 100×50..." value={form.size} onChange={(e) => setForm((f) => ({ ...f, size: e.target.value }))} />
              </div>
            </div>
            <div className="space-y-1">
              <Label>Цена продажи (₽)</Label>
              <Input
                type="number"
                inputMode="decimal"
                min={0}
                placeholder="0"
                value={form.salePriceAtOrder}
                onChange={(e) => setForm((f) => ({ ...f, salePriceAtOrder: e.target.value }))}
                required
              />
            </div>

            {form.productId && (
              <div className="space-y-2">
                <Label>Фото товара</Label>
                <div className="relative flex h-28 w-28 items-center justify-center overflow-hidden rounded-md border border-border bg-card">
                  {productImageLoading ? (
                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                  ) : productImageUrl ? (
                    <Image src={productImageUrl} alt="Товар" width={180} height={180} className="object-cover w-full h-full" unoptimized />
                  ) : (
                    <div className="text-center text-muted-foreground text-xs px-2">
                      <Package className="h-6 w-6 mx-auto mb-1 opacity-50" />
                      Нет фото
                      {productImageError && (
                        <div className="mt-1 text-[10px] leading-tight opacity-70">
                          {productImageError}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}
            </div>

            {/* Логистика */}
            <div className="space-y-3 rounded-lg border border-border/70 bg-background/35 p-3">
            <h3 className="text-sm font-semibold">Логистика</h3>
            <div className="space-y-1">
              <Label>Трек-номер *</Label>
              <Input
                value={form.trackingNumber}
                onChange={(e) => handleTrackingChange(e.target.value)}
                required
                placeholder="например: 1234567890"
              />
            </div>
            <div className="space-y-1">
              <Label>ТК</Label>
              <Input
                value={form.carrier}
                onChange={(e) => {
                  setCarrierTouched(true);
                  setForm((f) => ({ ...f, carrier: e.target.value }));
                }}
                placeholder={detectedCarrier || "Введите транспортную компанию"}
              />
              {detectedCarrier && form.carrier !== detectedCarrier && (
                <p className="text-xs text-muted-foreground">
                  Авто: <button type="button" className="font-medium text-foreground underline-offset-2 hover:underline" onClick={() => setForm((f) => ({ ...f, carrier: detectedCarrier }))}>{detectedCarrier}</button>
                </p>
              )}
            </div>

            {barcodeUrl && (
              <div className="space-y-1">
                <Label>Штрихкод</Label>
                <div className="flex items-center justify-center rounded-md border border-border bg-white p-2">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={barcodeUrl} alt="Штрихкод" className="h-20 object-contain" />
                </div>
              </div>
            )}

            <div className="space-y-1">
              <Label>Количество *</Label>
              <Input type="number" min={1} value={form.quantity} onChange={(e) => setForm((f) => ({ ...f, quantity: parseInt(e.target.value) || 1 }))} required />
            </div>
            <div className="space-y-1">
              <Label>Дата заказа *</Label>
              <input
                type="date"
                value={form.orderDate}
                onChange={(e) => setForm((f) => ({ ...f, orderDate: e.target.value }))}
                required
                className="flex h-10 w-full rounded-md border border-input bg-card px-3 py-2 text-sm font-medium text-foreground shadow-sm ring-offset-background focus-visible:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70 focus-visible:ring-offset-2"
                style={{ boxSizing: "border-box", maxWidth: "100%" }}
              />
            </div>
            <div className="grid grid-cols-1 gap-2 min-[380px]:grid-cols-3">
              <div className="space-y-1">
                <Label className="text-xs leading-tight">Логистика ₽</Label>
                <Input
                  type="number"
                  inputMode="decimal"
                  min={0}
                  placeholder="0"
                  value={form.logisticsCost}
                  onChange={(e) => setForm((f) => ({ ...f, logisticsCost: e.target.value }))}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs leading-tight">Комиссия ₽</Label>
                <Input
                  type="number"
                  inputMode="decimal"
                  min={0}
                  placeholder="0"
                  value={form.commissionCost}
                  onChange={(e) => setForm((f) => ({ ...f, commissionCost: e.target.value }))}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs leading-tight">Прочие ₽</Label>
                <Input
                  type="number"
                  inputMode="decimal"
                  min={0}
                  placeholder="0"
                  value={form.otherCosts}
                  onChange={(e) => setForm((f) => ({ ...f, otherCosts: e.target.value }))}
                />
              </div>
            </div>
            </div>

            {/* Закупка */}
            <div className="space-y-3 rounded-lg border border-border/70 bg-background/35 p-3">
            <h3 className="text-sm font-semibold">Закупка</h3>
            <div className="space-y-1">
              <Label>Контрагент (поставщик) *</Label>
              <div className="flex gap-2">
                <div className="flex-1">
                  <Select value={form.counterpartyId} onValueChange={(v) => setForm((f) => ({ ...f, counterpartyId: v }))}>
                    <SelectTrigger><SelectValue placeholder="Выберите поставщика" /></SelectTrigger>
                    <SelectContent>
                      {counterparties.map((c) => (
                        <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="flex-shrink-0"
                  onClick={() => setShowAddCp((v) => !v)}
                  aria-label={showAddCp ? "Скрыть форму" : "Добавить контрагента"}
                >
                  {showAddCp ? <X className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
                </Button>
              </div>
              {showAddCp && (
                <div className="mt-2 space-y-2 rounded-md border border-border bg-card p-3">
                  <Input
                    placeholder="Название *"
                    value={newCp.name}
                    onChange={(e) => setNewCp((c) => ({ ...c, name: e.target.value }))}
                  />
                  <Input
                    placeholder="Контакт (опционально)"
                    value={newCp.contactInfo}
                    onChange={(e) => setNewCp((c) => ({ ...c, contactInfo: e.target.value }))}
                  />
                  <Button
                    type="button"
                    size="sm"
                    className="w-full"
                    onClick={handleCreateCounterparty}
                    disabled={cpLoading || !newCp.name.trim()}
                  >
                    {cpLoading ? "Создание..." : "Создать контрагента"}
                  </Button>
                </div>
              )}
            </div>
            <div className="space-y-1">
              <Label>Закупочная цена за ед. (₽) *</Label>
              <Input
                type="number"
                inputMode="decimal"
                min={0}
                placeholder="0"
                value={form.purchasePricePerUnit}
                onChange={(e) => setForm((f) => ({ ...f, purchasePricePerUnit: e.target.value }))}
                required
              />
            </div>
            <div className="space-y-1">
              <Label>Комментарий к закупке</Label>
              <Textarea value={form.purchaseComment} onChange={(e) => setForm((f) => ({ ...f, purchaseComment: e.target.value }))} rows={2} />
            </div>
            </div>

            {/* Preview */}
            <div className="space-y-2 rounded-lg border border-primary/25 bg-primary/10 p-3">
            <h3 className="text-sm font-semibold text-foreground">Предварительный расчёт</h3>
            <div className="space-y-1 text-sm">
              {[
                ["Выручка", formatRub(preview.revenue)],
                ["Себестоимость", formatRub(preview.costOfGoods)],
                ["Валовая прибыль", formatRub(preview.grossProfit)],
                ["Маржинальность", `${preview.marginPercent.toFixed(1)}%`],
              ].map(([label, value]) => (
                <div key={label} className="flex items-center justify-between gap-4">
                  <span className="text-muted-foreground">{label}</span>
                  <span className="font-medium tabular-nums">{value}</span>
                </div>
              ))}
              <div className="flex items-center justify-between gap-4 border-t border-primary/20 pt-1.5">
                <span className="font-medium text-muted-foreground">Чистая прибыль</span>
                <span className={`font-bold tabular-nums ${preview.netProfit >= 0 ? "money-positive" : "money-negative"}`}>{formatRub(preview.netProfit)}</span>
              </div>
            </div>
            </div>
          </div>

          <div className="flex gap-2 border-t border-border/70 bg-card px-4 py-3">
            <Button type="button" variant="outline" className="flex-1" onClick={onClose}>Отмена</Button>
            <Button type="submit" className="flex-1" disabled={loading || !form.productId || !form.counterpartyId}>
              {loading ? "Создание..." : "Создать заказ"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
