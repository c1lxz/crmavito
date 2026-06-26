"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Plus, Search, Building2, Package, TrendingUp } from "lucide-react";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { formatRub } from "@/lib/utils";
import { toast } from "@/lib/hooks/use-toast";

interface Counterparty {
  id: string;
  name: string;
  contactInfo: string | null;
  comment: string | null;
  createdAt: string;
  ordersCount: number;
  totalPurchase: number;
  totalRevenue: number;
  totalProfit: number;
}

interface Props {
  counterparties: Counterparty[];
}

export function CounterpartiesClient({ counterparties: initial }: Props) {
  const router = useRouter();
  const [counterparties, setCounterparties] = useState(initial);
  const [search, setSearch] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState("");
  const [contactInfo, setContactInfo] = useState("");
  const [comment, setComment] = useState("");
  const [loading, setLoading] = useState(false);

  const filtered = counterparties.filter((cp) =>
    cp.name.toLowerCase().includes(search.toLowerCase()) ||
    (cp.contactInfo ?? "").toLowerCase().includes(search.toLowerCase())
  );

  async function handleCreate() {
    if (!name.trim()) return;
    setLoading(true);
    try {
      const res = await fetch("/api/counterparties", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), contactInfo: contactInfo || undefined, comment: comment || undefined }),
      });
      if (!res.ok) throw new Error("Ошибка создания");
      const cp = await res.json();
      setCounterparties((prev) => [...prev, { ...cp, ordersCount: 0, totalPurchase: 0, totalRevenue: 0, totalProfit: 0 }]);
      setShowCreate(false);
      setName(""); setContactInfo(""); setComment("");
      toast({ title: "Контрагент создан" });
      router.refresh();
    } catch (e) {
      toast({ title: "Ошибка", description: String(e), variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="sticky top-0 z-30 bg-background/95 backdrop-blur-sm border-b px-4 pt-[var(--app-top-pad)] pb-3">
        <div className="flex items-center gap-3 mb-3">
          <Link href="/dashboard"><ArrowLeft className="h-5 w-5" /></Link>
          <h1 className="font-bold text-lg flex-1">Контрагенты</h1>
          <Button size="sm" onClick={() => setShowCreate(true)}>
            <Plus className="h-4 w-4 mr-1" /> Добавить
          </Button>
        </div>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Поиск по названию..."
            className="pl-9"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      <div className="px-4 py-3 space-y-2">
        {filtered.length === 0 && (
          <div className="text-center py-12 text-muted-foreground">
            <Building2 className="h-10 w-10 mx-auto mb-3 opacity-30" />
            <p>{search ? "Ничего не найдено" : "Нет контрагентов"}</p>
          </div>
        )}

        {filtered.map((cp) => (
          <Card key={cp.id} className="hover:bg-accent transition-colors cursor-pointer">
            <CardContent className="p-4">
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold text-sm flex-shrink-0">
                    {cp.name.charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <p className="font-semibold">{cp.name}</p>
                    {cp.contactInfo && (
                      <p className="text-xs text-muted-foreground">{cp.contactInfo}</p>
                    )}
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="bg-muted rounded-lg p-2">
                  <div className="flex items-center justify-center gap-1 mb-0.5">
                    <Package className="h-3 w-3 text-muted-foreground" />
                  </div>
                  <p className="text-xs font-semibold">{cp.ordersCount}</p>
                  <p className="text-[10px] text-muted-foreground">заказов</p>
                </div>
                <div className="bg-muted rounded-lg p-2">
                  <p className="text-xs font-semibold">{formatRub(cp.totalPurchase)}</p>
                  <p className="text-[10px] text-muted-foreground">закуплено</p>
                </div>
                <div className="bg-muted rounded-lg p-2">
                  <div className="flex items-center justify-center gap-1 mb-0.5">
                    <TrendingUp className="h-3 w-3 text-emerald-600" />
                  </div>
                  <p className={`text-xs font-semibold ${cp.totalProfit >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-destructive"}`}>
                    {formatRub(cp.totalProfit)}
                  </p>
                  <p className="text-[10px] text-muted-foreground">прибыль</p>
                </div>
              </div>

              {cp.comment && (
                <p className="text-xs text-muted-foreground mt-2 border-t border-border pt-2">{cp.comment}</p>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Create dialog */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Новый контрагент</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label>Название *</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="ООО Ромашка" />
            </div>
            <div className="space-y-1">
              <Label>Контакт</Label>
              <Input value={contactInfo} onChange={(e) => setContactInfo(e.target.value)} placeholder="+7 999 123-45-67" />
            </div>
            <div className="space-y-1">
              <Label>Комментарий</Label>
              <Textarea value={comment} onChange={(e) => setComment(e.target.value)} rows={2} placeholder="Оптовый поставщик..." />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)}>Отмена</Button>
            <Button onClick={handleCreate} disabled={loading || !name.trim()}>
              {loading ? "..." : "Создать"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
