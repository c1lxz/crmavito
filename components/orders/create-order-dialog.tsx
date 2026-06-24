"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { formatRub } from "@/lib/utils";
import { calcOrderFinancials } from "@/lib/finance/calculations";
import { toast } from "@/lib/hooks/use-toast";

interface Product { id: string; name: string; salePrice: number; }
interface Counterparty { id: string; name: string; }

interface Props {
  open: boolean;
  onClose: () => void;
  products: Product[];
  counterparties: Counterparty[];
}

export function CreateOrderDialog({ open, onClose, products, counterparties }: Props) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({
    productId: "",
    variant: "",
    quantity: 1,
    salePriceAtOrder: 0,
    counterpartyId: "",
    purchasePricePerUnit: 0,
    purchaseComment: "",
    trackingNumber: "",
    orderDate: new Date().toISOString().slice(0, 10),
    destinationCity: "",
    logisticsCost: 0,
    commissionCost: 0,
    otherCosts: 0,
  });
  const [productSearch, setProductSearch] = useState("");

  const filteredProducts = products.filter((p) =>
    p.name.toLowerCase().includes(productSearch.toLowerCase())
  );

  function handleProductSelect(id: string) {
    const p = products.find((x) => x.id === id);
    if (p) {
      setForm((f) => ({ ...f, productId: id, salePriceAtOrder: p.salePrice }));
      setProductSearch(p.name);
    }
  }

  const preview = calcOrderFinancials({
    salePriceAtOrder: form.salePriceAtOrder,
    quantity: form.quantity,
    purchasePricePerUnit: form.purchasePricePerUnit,
    logisticsCost: form.logisticsCost,
    commissionCost: form.commissionCost,
    otherCosts: form.otherCosts,
  });

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
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
      <DialogContent className="max-h-[90vh] overflow-y-auto max-w-md">
        <DialogHeader>
          <DialogTitle>Новый заказ</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Товар */}
          <div className="space-y-3 p-3 bg-muted/50 rounded-lg">
            <h3 className="font-medium text-sm">Товар</h3>
            <div className="space-y-1">
              <Label>Поиск товара</Label>
              <Input
                placeholder="Начните вводить название..."
                value={productSearch}
                onChange={(e) => setProductSearch(e.target.value)}
              />
              {productSearch && !form.productId && (
                <div className="border rounded-lg bg-background max-h-40 overflow-y-auto">
                  {filteredProducts.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      className="w-full text-left px-3 py-2 text-sm hover:bg-muted"
                      onClick={() => handleProductSelect(p.id)}
                    >
                      <span>{p.name}</span>
                      <span className="text-muted-foreground ml-2">{formatRub(p.salePrice)}</span>
                    </button>
                  ))}
                  {filteredProducts.length === 0 && <p className="px-3 py-2 text-sm text-muted-foreground">Не найдено</p>}
                </div>
              )}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label>Цвет / вариант</Label>
                <Input placeholder="Белый, Чёрный..." value={form.variant} onChange={(e) => setForm((f) => ({ ...f, variant: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <Label>Цена продажи (₽)</Label>
                <Input type="number" min={0} value={form.salePriceAtOrder} onChange={(e) => setForm((f) => ({ ...f, salePriceAtOrder: parseFloat(e.target.value) || 0 }))} required />
              </div>
            </div>
          </div>

          {/* Логистика */}
          <div className="space-y-3 p-3 bg-muted/50 rounded-lg">
            <h3 className="font-medium text-sm">Логистика</h3>
            <div className="space-y-1">
              <Label>Трек-номер *</Label>
              <Input value={form.trackingNumber} onChange={(e) => setForm((f) => ({ ...f, trackingNumber: e.target.value }))} required />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label>Количество *</Label>
                <Input type="number" min={1} value={form.quantity} onChange={(e) => setForm((f) => ({ ...f, quantity: parseInt(e.target.value) || 1 }))} required />
              </div>
              <div className="space-y-1">
                <Label>Дата заказа *</Label>
                <Input type="date" value={form.orderDate} onChange={(e) => setForm((f) => ({ ...f, orderDate: e.target.value }))} required />
              </div>
            </div>
            <div className="space-y-1">
              <Label>Город получателя *</Label>
              <Input value={form.destinationCity} onChange={(e) => setForm((f) => ({ ...f, destinationCity: e.target.value }))} required />
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div className="space-y-1">
                <Label className="text-xs">Логистика ₽</Label>
                <Input type="number" min={0} value={form.logisticsCost} onChange={(e) => setForm((f) => ({ ...f, logisticsCost: parseFloat(e.target.value) || 0 }))} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Комиссия ₽</Label>
                <Input type="number" min={0} value={form.commissionCost} onChange={(e) => setForm((f) => ({ ...f, commissionCost: parseFloat(e.target.value) || 0 }))} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Прочие ₽</Label>
                <Input type="number" min={0} value={form.otherCosts} onChange={(e) => setForm((f) => ({ ...f, otherCosts: parseFloat(e.target.value) || 0 }))} />
              </div>
            </div>
          </div>

          {/* Закупка */}
          <div className="space-y-3 p-3 bg-muted/50 rounded-lg">
            <h3 className="font-medium text-sm">Закупка</h3>
            <div className="space-y-1">
              <Label>Контрагент (поставщик) *</Label>
              <Select value={form.counterpartyId} onValueChange={(v) => setForm((f) => ({ ...f, counterpartyId: v }))}>
                <SelectTrigger><SelectValue placeholder="Выберите поставщика" /></SelectTrigger>
                <SelectContent>
                  {counterparties.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Закупочная цена за ед. (₽) *</Label>
              <Input type="number" min={0} value={form.purchasePricePerUnit} onChange={(e) => setForm((f) => ({ ...f, purchasePricePerUnit: parseFloat(e.target.value) || 0 }))} required />
            </div>
            <div className="space-y-1">
              <Label>Комментарий к закупке</Label>
              <Textarea value={form.purchaseComment} onChange={(e) => setForm((f) => ({ ...f, purchaseComment: e.target.value }))} rows={2} />
            </div>
          </div>

          {/* Preview */}
          <div className="p-3 bg-primary/5 border border-primary/20 rounded-lg space-y-1">
            <h3 className="font-medium text-sm text-primary">Предварительный расчёт</h3>
            <div className="grid grid-cols-2 gap-x-4 text-sm">
              <span className="text-muted-foreground">Выручка:</span><span className="font-medium">{formatRub(preview.revenue)}</span>
              <span className="text-muted-foreground">Себестоимость:</span><span className="font-medium">{formatRub(preview.costOfGoods)}</span>
              <span className="text-muted-foreground">Валовая прибыль:</span><span className="font-medium">{formatRub(preview.grossProfit)}</span>
              <span className="text-muted-foreground">Маржинальность:</span><span className="font-medium">{preview.marginPercent.toFixed(1)}%</span>
              <span className="text-muted-foreground font-medium">Чистая прибыль:</span><span className={`font-bold ${preview.netProfit >= 0 ? "text-emerald-600" : "text-red-600"}`}>{formatRub(preview.netProfit)}</span>
            </div>
          </div>

          <div className="flex gap-2">
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
