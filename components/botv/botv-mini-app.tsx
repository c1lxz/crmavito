"use client";

import { useMemo, useRef, useState } from "react";
import { Check, Download, Eye, FileArchive, ImageIcon, Loader2, Package, Search, Trash2, UploadCloud, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import type { BotvProduct, BotvSession } from "@/lib/botv/session";

type Status = "idle" | "uploading" | "ready" | "saving" | "generating";

function formatRub(value: number | null) {
  if (value == null) return "Цена не задана";
  return new Intl.NumberFormat("ru-RU").format(value) + " ₽";
}

function photoUrl(sessionId: string, token: string | null) {
  return token ? `/api/botv/session/${sessionId}/photo?token=${encodeURIComponent(token)}` : "";
}

export function BotvMiniApp() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [session, setSession] = useState<BotvSession | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<number>>(() => new Set());
  const [bulkPrice, setBulkPrice] = useState("");
  const [diskLink, setDiskLink] = useState("");
  const [preview, setPreview] = useState<BotvProduct | null>(null);

  const products = session?.products ?? [];
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return products.filter((p) => !q || p.name.toLowerCase().includes(q) || p.adTitle.toLowerCase().includes(q));
  }, [products, query]);
  const selectedIds = Array.from(selected);
  const allVisibleSelected = filtered.length > 0 && filtered.every((p) => selected.has(p.index));

  async function uploadLink() {
    if (!diskLink.trim()) return;
    setStatus("uploading");
    setError("");
    setSelected(new Set());
    const form = new FormData();
    form.append("link", diskLink.trim());
    const res = await fetch("/api/botv/session", { method: "POST", body: form });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? "Не удалось загрузить ссылку");
    setSession(data);
    setStatus("ready");
  }

  async function upload(file: File) {
    setStatus("uploading");
    setError("");
    setSelected(new Set());
    const form = new FormData();
    form.append("archive", file);
    const res = await fetch("/api/botv/session", { method: "POST", body: form });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? "Не удалось загрузить архив");
    setSession(data);
    setStatus("ready");
  }

  async function patch(payload: unknown) {
    if (!session) return;
    setStatus("saving");
    const res = await fetch(`/api/botv/session/${session.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? "Не удалось сохранить");
    setSession(data);
    setStatus("ready");
  }

  async function generateXml() {
    if (!session) return;
    setStatus("generating");
    setError("");
    const res = await fetch(`/api/botv/session/${session.id}/xml`, { method: "POST" });
    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error ?? "Не удалось собрать XML");
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = res.headers.get("content-disposition")?.match(/filename="(.+)"/)?.[1] ?? "avito.xml";
    a.click();
    URL.revokeObjectURL(url);
    setStatus("ready");
  }

  async function run(action: () => Promise<void>) {
    try { await action(); } catch (err) { setError(err instanceof Error ? err.message : String(err)); setStatus(session ? "ready" : "idle"); }
  }

  function toggle(index: number) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(index)) next.delete(index); else next.add(index);
      return next;
    });
  }

  return (
    <div className="app-shell">
      <div className="app-header">
        <div className="mb-3 flex items-center gap-3">
          <div className="icon-tile h-9 w-9"><FileArchive className="h-4 w-4" /></div>
          <div className="min-w-0 flex-1">
            <h1 className="text-lg font-semibold tracking-tight">Выгрузка объявлений</h1>
            <p className="section-caption">Архив, названия, цены и XML для Avito</p>
          </div>
          <Button size="sm" onClick={() => fileRef.current?.click()} disabled={status === "uploading"}>
            {status === "uploading" ? <Loader2 className="h-4 w-4 animate-spin" /> : <UploadCloud className="h-4 w-4" />}
            Архив
          </Button>
          <input ref={fileRef} type="file" accept=".zip,.rar,.7z" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) run(() => upload(f)); }} />
        </div>
        <div className="mb-2 flex gap-2">
          <Input placeholder="Ссылка на Яндекс.Диск" value={diskLink} onChange={(e) => setDiskLink(e.target.value)} />
          <Button variant="outline" onClick={() => run(uploadLink)} disabled={status === "uploading" || !diskLink.trim()}>Загрузить</Button>
        </div>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder="Поиск по товарам" className="pl-9" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
      </div>

      {session && (
        <div className="flex gap-4 overflow-x-auto border-b border-border/80 bg-card/45 px-4 py-3 text-sm">
          <span className="text-muted-foreground">Всего: <b className="text-foreground">{session.summary.total}</b></span>
          <span className="text-muted-foreground">Готово: <b className="text-foreground">{session.summary.ready}</b></span>
          <span className="text-muted-foreground">Удалено: <b className="text-foreground">{session.summary.deleted}</b></span>
          <span className="text-muted-foreground">Фото: <b className="text-foreground">{session.summary.photos}</b></span>
        </div>
      )}

      <div className="app-content space-y-3">
        {!session && (
          <Card><CardContent className="p-5 text-center">
            <UploadCloud className="mx-auto mb-3 h-10 w-10 text-muted-foreground" />
            <p className="text-sm font-semibold">Загрузи архив .zip, .rar или .7z</p>
            <p className="mt-1 text-xs text-muted-foreground">После распаковки здесь появятся карточки товаров с первым фото.</p>
          </CardContent></Card>
        )}

        {error && <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">{error}</div>}

        {session && (
          <Card><CardContent className="space-y-2 p-3">
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={() => setSelected(allVisibleSelected ? new Set() : new Set(filtered.map((p) => p.index)))}>{allVisibleSelected ? "Снять выбор" : "Выбрать видимые"}</Button>
              <Button size="sm" variant="outline" disabled={!selected.size} onClick={() => run(() => patch({ ids: selectedIds, bulkOriginalTitle: true }))}><Check className="h-4 w-4" /> Название из папки</Button>
              <Input className="h-8 w-28" placeholder="Цена" value={bulkPrice} onChange={(e) => setBulkPrice(e.target.value)} />
              <Button size="sm" variant="outline" disabled={!selected.size || !bulkPrice} onClick={() => run(() => patch({ ids: selectedIds, bulkPrice }))}>Одна цена</Button>
              <Button size="sm" variant="destructive" disabled={!selected.size} onClick={() => run(() => patch({ ids: selectedIds, deleteSelected: true }))}><Trash2 className="h-4 w-4" /> Удалить</Button>
              <Button size="sm" disabled={status === "generating"} onClick={() => run(generateXml)}><Download className="h-4 w-4" /> XML</Button>
            </div>
            <div className="space-y-1 text-xs text-muted-foreground">{session.progress.slice(-5).map((item, i) => <div key={i}>• {item}</div>)}</div>
          </CardContent></Card>
        )}

        {filtered.map((product) => (
          <Card key={product.id} className={product.deleted ? "opacity-45" : "transition-colors hover:border-primary/25 hover:bg-accent/45"}>
            <CardContent className="flex gap-3 p-3">
              <button className="mt-4 h-5 w-5 rounded border border-input text-xs" onClick={() => toggle(product.index)}>{selected.has(product.index) ? "✓" : ""}</button>
              <div className="h-16 w-16 shrink-0 overflow-hidden rounded-md bg-muted">
                {product.firstPhoto && session ? <img src={photoUrl(session.id, product.firstPhoto)} alt="" className="h-full w-full object-cover" /> : <div className="flex h-full w-full items-center justify-center text-muted-foreground"><ImageIcon className="h-5 w-5" /></div>}
              </div>
              <div className="min-w-0 flex-1 space-y-2">
                <div className="flex gap-2">
                  <div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold">#{product.index} {product.name}</p><p className="text-xs text-muted-foreground">{product.photoCount} фото · {formatRub(product.price)}</p></div>
                  <Button size="icon" variant="ghost" onClick={() => setPreview(product)}><Eye className="h-4 w-4" /></Button>
                </div>
                <Input value={product.adTitle} disabled={product.useOriginalTitle || product.deleted} onChange={(e) => setSession((s) => s && ({ ...s, products: s.products.map((p) => p.index === product.index ? { ...p, adTitle: e.target.value } : p) }))} onBlur={() => run(() => patch({ products: [{ index: product.index, adTitle: product.adTitle }] }))} />
                <div className="flex gap-2">
                  <Input inputMode="numeric" placeholder="Цена" value={product.price ?? ""} disabled={product.deleted} onChange={(e) => setSession((s) => s && ({ ...s, products: s.products.map((p) => p.index === product.index ? { ...p, price: e.target.value ? Number(e.target.value) : null } : p) }))} onBlur={() => run(() => patch({ products: [{ index: product.index, price: product.price }] }))} />
                  <Button size="icon" variant={product.useOriginalTitle ? "default" : "outline"} onClick={() => run(() => patch({ products: [{ index: product.index, useOriginalTitle: !product.useOriginalTitle }] }))}><Package className="h-4 w-4" /></Button>
                  <Button size="icon" variant="outline" onClick={() => run(() => patch({ products: [{ index: product.index, deleted: !product.deleted }] }))}>{product.deleted ? <X className="h-4 w-4" /> : <Trash2 className="h-4 w-4" />}</Button>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {preview && session && (
        <div className="fixed inset-0 z-50 bg-background/85 p-4 backdrop-blur-sm" onClick={() => setPreview(null)}>
          <Card className="mx-auto max-h-[92vh] max-w-md overflow-auto" onClick={(e) => e.stopPropagation()}><CardContent className="space-y-3 p-4">
            <div className="flex items-center justify-between"><h2 className="text-base font-semibold">Как на Avito</h2><Button size="icon" variant="ghost" onClick={() => setPreview(null)}><X className="h-4 w-4" /></Button></div>
            <div className="flex gap-2 overflow-x-auto">{preview.photos.map((token) => <img key={token} src={photoUrl(session.id, token)} className="h-48 w-64 rounded-md object-cover" alt="" />)}</div>
            <div><p className="text-lg font-semibold">{preview.adTitle}</p><p className="mt-1 text-xl font-bold">{formatRub(preview.price)}</p><p className="mt-2 text-sm text-muted-foreground">{preview.name}</p></div>
          </CardContent></Card>
        </div>
      )}
    </div>
  );
}
