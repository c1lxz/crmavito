"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { Plus, Search, ShoppingCart, Truck, Megaphone, Package, Percent, DollarSign, MoreHorizontal, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { formatRub, formatDate } from "@/lib/utils";
import { EXPENSE_CATEGORY_LABELS, EXPENSE_CATEGORY_COLORS } from "@/lib/constants";
import { toast } from "@/lib/hooks/use-toast";
import type { ExpenseCategory } from "@prisma/client";

interface Expense {
  id: string;
  date: string;
  category: ExpenseCategory;
  title: string | null;
  amount: number;
  paymentMethod: string | null;
  comment: string | null;
  createdAt: string;
  createdBy: { name: string };
}

interface Props {
  initialData: {
    expenses: Expense[];
    monthByCategory: Record<string, number>;
    monthTotal: number;
  };
}

const CATEGORY_ICONS: Record<string, React.ReactNode> = {
  PURCHASE: <ShoppingCart className="h-4 w-4" />,
  LOGISTICS: <Truck className="h-4 w-4" />,
  ADVERTISING: <Megaphone className="h-4 w-4" />,
  PACKAGING: <Package className="h-4 w-4" />,
  AVITO_COMMISSION: <Percent className="h-4 w-4" />,
  SALARY: <DollarSign className="h-4 w-4" />,
  OTHER: <MoreHorizontal className="h-4 w-4" />,
};

const CATEGORIES = Object.entries(EXPENSE_CATEGORY_LABELS) as [ExpenseCategory, string][];

export function ExpensesClient({ initialData }: Props) {
  const router = useRouter();
  const [expenses, setExpenses] = useState(initialData.expenses);
  const [search, setSearch] = useState("");
  const [catFilter, setCatFilter] = useState("ALL");
  const [showCreate, setShowCreate] = useState(false);
  const [loading, setLoading] = useState(false);
  const blankForm = () => ({
    date: new Date().toISOString().slice(0, 10),
    category: "" as ExpenseCategory | "",
    title: "",
    amount: "",
    paymentMethod: "",
    comment: "",
  });
  const [form, setForm] = useState(blankForm);

  function closeCreate() {
    setShowCreate(false);
    setForm(blankForm());
  }

  const filtered = useMemo(() => {
    return expenses.filter((e) => {
      if (catFilter !== "ALL" && e.category !== catFilter) return false;
      if (search) {
        const q = search.toLowerCase();
        return (e.title ?? "").toLowerCase().includes(q) || (e.comment ?? "").toLowerCase().includes(q);
      }
      return true;
    });
  }, [expenses, search, catFilter]);

  const totalFiltered = filtered.reduce((s, e) => s + e.amount, 0);
  const days = filtered.length > 0
    ? Math.max(1, Math.ceil((new Date(filtered[0].date).getTime() - new Date(filtered[filtered.length - 1].date).getTime()) / 86400000) + 1)
    : 1;

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!form.category) return;
    setLoading(true);
    try {
      const res = await fetch("/api/expenses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, amount: parseFloat(form.amount) }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        const message = typeof data?.error === "string" ? data.error : "Не удалось сохранить расход";
        throw new Error(message);
      }
      toast({ title: "Расход добавлен" });
      closeCreate();
      router.refresh();
    } catch (err) {
      toast({ title: "Ошибка", description: err instanceof Error ? err.message : String(err), variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="app-shell">
      <div className="app-header">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Расходы</h1>
            <p className="section-caption">Контроль затрат и оплат</p>
          </div>
          <Button size="sm" onClick={() => setShowCreate(true)}>
            <Plus className="h-4 w-4" />
            Добавить расход
          </Button>
        </div>
        <div className="space-y-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Поиск по расходам" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
          </div>
          <div className="flex gap-2 overflow-x-auto pb-1 no-scrollbar">
            <button
              onClick={() => setCatFilter("ALL")}
              className={`filter-chip ${catFilter === "ALL" ? "filter-chip-active" : ""}`}
            >
              Все
            </button>
            {CATEGORIES.map(([v, l]) => (
              <button
                key={v}
                onClick={() => setCatFilter(v)}
                className={`filter-chip ${catFilter === v ? "filter-chip-active" : ""}`}
              >
                {l}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="px-4 py-3">
        <h2 className="section-title mb-2">Расходы за месяц</h2>
        <div className="grid grid-cols-4 gap-2 mb-2">
          <Card className="col-span-4 border-primary/25 bg-accent/65">
            <CardContent className="p-3 text-center">
              <p className="text-xs text-muted-foreground">Всего</p>
              <p className="text-lg font-semibold text-foreground tabular-nums">{formatRub(initialData.monthTotal)}</p>
            </CardContent>
          </Card>
        </div>
        <div className="grid grid-cols-3 gap-2">
          {CATEGORIES.map(([cat, label]) => (
            <Card key={cat} className="border-border/60 bg-card">
              <CardContent className="p-2 text-center">
                <div className="flex justify-center mb-1" style={{ color: EXPENSE_CATEGORY_COLORS[cat] }}>
                  {CATEGORY_ICONS[cat]}
                </div>
                <p className="text-[10px] text-muted-foreground leading-tight mb-0.5">{label}</p>
                <p className="text-xs font-semibold">{formatRub(initialData.monthByCategory[cat] ?? 0)}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>

      {/* List */}
      <div className="px-4 space-y-2 pb-24">
        {filtered.map((exp) => (
          <Card key={exp.id}>
            <CardContent className="p-3">
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0" style={{ backgroundColor: EXPENSE_CATEGORY_COLORS[exp.category] + "20", color: EXPENSE_CATEGORY_COLORS[exp.category] }}>
                  {CATEGORY_ICONS[exp.category]}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-medium text-sm">{exp.title ?? EXPENSE_CATEGORY_LABELS[exp.category]}</p>
                      {exp.comment && <p className="text-xs text-muted-foreground truncate">{exp.comment}</p>}
                    </div>
                    <p className="font-semibold text-sm whitespace-nowrap">{formatRub(exp.amount)}</p>
                  </div>
                  <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
                    <span>{formatDate(exp.date)}</span>
                    {exp.paymentMethod && <span>· {exp.paymentMethod}</span>}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
        {filtered.length === 0 && (
          <div className="text-center text-muted-foreground py-16 flex flex-col items-center gap-3">
            <div className="w-14 h-14 rounded-lg bg-muted flex items-center justify-center">
              <Wallet className="h-8 w-8 text-muted-foreground/70" strokeWidth={1.5} />
            </div>
            <p className="text-sm font-medium">Расходов не найдено</p>
          </div>
        )}
      </div>

      <div className="px-4 py-4 border-t border-border/80 bg-card/45">
        <div className="flex justify-between text-sm text-muted-foreground">
          <span>Всего расходов: <strong className="text-foreground">{formatRub(totalFiltered)}</strong></span>
          <span>Средний в день: <strong className="text-foreground">{formatRub(Math.round(totalFiltered / days))}</strong></span>
        </div>
      </div>

      {/* Create dialog */}
      <Dialog open={showCreate} onOpenChange={(o) => !o && closeCreate()}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Добавить расход</DialogTitle></DialogHeader>
          <form onSubmit={handleCreate} className="space-y-3">
            <div className="space-y-1">
              <Label>Дата</Label>
              <Input type="date" value={form.date} onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))} required />
            </div>
            <div className="space-y-1">
              <Label>Категория *</Label>
              <Select value={form.category} onValueChange={(v) => setForm((f) => ({ ...f, category: v as ExpenseCategory }))}>
                <SelectTrigger><SelectValue placeholder="Выберите категорию" /></SelectTrigger>
                <SelectContent>
                  {CATEGORIES.map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Название</Label>
              <Input value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} placeholder="Доставка заказов..." />
            </div>
            <div className="space-y-1">
              <Label>Сумма (₽) *</Label>
              <Input type="number" inputMode="decimal" min={0} placeholder="0" value={form.amount} onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))} required />
            </div>
            <div className="space-y-1">
              <Label>Способ оплаты</Label>
              <Input value={form.paymentMethod} onChange={(e) => setForm((f) => ({ ...f, paymentMethod: e.target.value }))} placeholder="Тинькофф, Наличные..." />
            </div>
            <div className="space-y-1">
              <Label>Комментарий</Label>
              <Textarea value={form.comment} onChange={(e) => setForm((f) => ({ ...f, comment: e.target.value }))} rows={2} />
            </div>
            <div className="flex gap-2">
              <Button type="button" variant="outline" className="flex-1" onClick={closeCreate}>Отмена</Button>
              <Button type="submit" className="flex-1" disabled={loading || !form.category || !form.amount}>
                {loading ? "Сохранение..." : "Добавить"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
