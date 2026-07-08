"use client";

import { useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Download,
  FileArchive,
  ImageIcon,
  Loader2,
  Package,
  PanelTop,
  Search,
  Trash2,
  UploadCloud,
  X,
} from "lucide-react";
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
  return token
    ? `/api/botv/session/${sessionId}/photo?token=${encodeURIComponent(token)}`
    : "";
}

function ListingPreview({ product, sessionId }: { product: BotvProduct | null; sessionId: string | null }) {
  if (!product || !sessionId) {
    return (
      <Card>
        <CardContent className="flex min-h-[360px] flex-col items-center justify-center p-6 text-center text-muted-foreground">
          <ImageIcon className="mb-3 h-9 w-9 opacity-50" />
          <p className="text-sm font-semibold text-foreground">Предпросмотр</p>
          <p className="mt-1 text-xs">Нажми на карточку объявления, чтобы увидеть вид Avito.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="max-h-[calc(100vh-2rem)] overflow-y-auto">
      <CardContent className="space-y-4 p-4 sm:p-5">
        <div>
          <p className="text-xs font-medium uppercase text-muted-foreground">Как на Avito</p>
          <h2 className="mt-1 text-xl font-semibold leading-tight">{product.adTitle}</h2>
        </div>
        <div className="flex snap-x gap-2 overflow-x-auto pb-1">
          {product.photos.length > 0 ? (
            product.photos.map((token) => (
              <img
                key={token}
                src={photoUrl(sessionId, token)}
                className="h-72 w-full min-w-full snap-center rounded-md object-cover sm:h-96"
                alt=""
              />
            ))
          ) : (
            <div className="flex h-64 w-full items-center justify-center rounded-md bg-muted text-muted-foreground">
              <ImageIcon className="h-7 w-7" />
            </div>
          )}
        </div>
        <div className="space-y-2">
          <p className="text-2xl font-bold tracking-tight">{formatRub(product.price)}</p>
          <p className="text-sm text-muted-foreground">{product.name}</p>
          <div className="flex gap-2 text-xs text-muted-foreground">
            <span>{product.photoCount} фото</span>
            {product.useOriginalTitle && <span>Название из папки</span>}
            {product.deleted && <span className="text-destructive">Удалено из XML</span>}
          </div>
        </div>
        <div className="grid gap-2 rounded-md border border-border/80 bg-muted/35 p-3 text-sm sm:grid-cols-2">
          <div><span className="text-muted-foreground">Категория: </span>{product.details.category || "Одежда"}</div>
          <div><span className="text-muted-foreground">Цвет: </span>{product.details.color || "Не указан"}</div>
          <div><span className="text-muted-foreground">Размер: </span>{product.details.size || "Без размера"}</div>
          <div><span className="text-muted-foreground">Состояние: </span>{product.details.condition || "Новое"}</div>
          <div><span className="text-muted-foreground">Тип: </span>{product.details.goodsType || "Мужская одежда"}</div>
          <div><span className="text-muted-foreground">Адрес: </span>{product.details.location || "Москва"}</div>
        </div>
        <div>
          <p className="mb-2 text-sm font-semibold">Описание</p>
          <p className="whitespace-pre-line text-sm leading-6 text-muted-foreground">{product.description || "Описание будет сформировано при создании XML."}</p>
        </div>
      </CardContent>
    </Card>
  );
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
  const [phonePromptOpen, setPhonePromptOpen] = useState(false);
  const [replacementPhone, setReplacementPhone] = useState("");

  const products = session?.products ?? [];
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return products.filter(
      (p) => !q || p.name.toLowerCase().includes(q) || p.adTitle.toLowerCase().includes(q),
    );
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

  async function downloadXml(phone?: string) {
    if (!session) return;
    setStatus("generating");
    setError("");
    const res = await fetch(`/api/botv/session/${session.id}/xml`, {
      method: "POST",
      headers: phone ? { "content-type": "application/json" } : undefined,
      body: phone ? JSON.stringify({ phone }) : undefined,
    });
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

  async function generateXml() {
    await downloadXml();
    setPhonePromptOpen(true);
  }

  async function run(action: () => Promise<void>) {
    try {
      await action();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStatus(session ? "ready" : "idle");
    }
  }

  function toggle(index: number) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }

  function openPreview(product: BotvProduct) {
    setPreview(product);
  }

  async function movePhoto(product: BotvProduct, token: string, direction: "first" | "left" | "right") {
    await patch({ products: [{ index: product.index, movePhoto: { token, direction } }] });
    setPreview((current) => current && current.index === product.index ? {
      ...current,
      photos: reorderTokens(current.photos, token, direction),
      firstPhoto: reorderTokens(current.photos, token, direction)[0] ?? null,
    } : current);
  }

  function reorderTokens(tokens: string[], token: string, direction: "first" | "left" | "right") {
    const next = [...tokens];
    const index = next.indexOf(token);
    if (index < 0) return next;
    const [item] = next.splice(index, 1);
    const target = direction === "first" ? 0 : direction === "left" ? Math.max(0, index - 1) : Math.min(next.length, index + 1);
    next.splice(target, 0, item);
    return next;
  }

  return (
    <div className="app-shell">
      <div className="app-header lg:px-8">
        <div className="mx-auto max-w-[1600px]">
          <div className="mb-3 flex items-center gap-3">
            <div className="icon-tile h-9 w-9"><FileArchive className="h-4 w-4" /></div>
            <div className="min-w-0 flex-1">
              <h1 className="text-lg font-semibold tracking-tight lg:text-xl">Выгрузка объявлений</h1>
              <p className="section-caption">Архив, названия, цены и XML для Avito</p>
            </div>
            <Button size="sm" onClick={() => fileRef.current?.click()} disabled={status === "uploading"}>
              {status === "uploading" ? <Loader2 className="h-4 w-4 animate-spin" /> : <UploadCloud className="h-4 w-4" />}
              Архив
            </Button>
            <input ref={fileRef} type="file" accept=".zip,.rar,.7z" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) run(() => upload(f)); }} />
          </div>
          <div className="grid gap-2 lg:grid-cols-[minmax(320px,1fr)_minmax(260px,420px)]">
            <div className="flex gap-2">
              <Input placeholder="Ссылка на Яндекс.Диск" value={diskLink} onChange={(e) => setDiskLink(e.target.value)} />
              <Button variant="outline" onClick={() => run(uploadLink)} disabled={status === "uploading" || !diskLink.trim()}>Загрузить</Button>
            </div>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input placeholder="Поиск по товарам" className="pl-9" value={query} onChange={(e) => setQuery(e.target.value)} />
            </div>
          </div>
        </div>
      </div>

      {session && (
        <div className="border-b border-border/80 bg-card/45 px-4 py-3 text-sm lg:px-8">
          <div className="mx-auto flex max-w-[1600px] gap-5 overflow-x-auto">
            <span className="text-muted-foreground">Всего: <b className="text-foreground">{session.summary.total}</b></span>
            <span className="text-muted-foreground">Готово: <b className="text-foreground">{session.summary.ready}</b></span>
            <span className="text-muted-foreground">Удалено: <b className="text-foreground">{session.summary.deleted}</b></span>
            <span className="text-muted-foreground">Фото: <b className="text-foreground">{session.summary.photos}</b></span>
          </div>
        </div>
      )}

      <div className="app-content mx-auto w-full max-w-[1600px] lg:px-8">
        <div className="space-y-3">
          {!session && (
            <Card><CardContent className="p-6 text-center lg:p-10">
              <UploadCloud className="mx-auto mb-3 h-10 w-10 text-muted-foreground" />
              <p className="text-sm font-semibold">Загрузи архив .zip, .rar или .7z</p>
              <p className="mt-1 text-xs text-muted-foreground">После распаковки здесь появятся карточки товаров с первым фото.</p>
            </CardContent></Card>
          )}

          {error && <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">{error}</div>}

          {session && (
            <Card className="sticky top-[132px] z-20 lg:top-[142px]"><CardContent className="space-y-3 p-3">
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={() => setSelected(allVisibleSelected ? new Set() : new Set(filtered.map((p) => p.index)))}>{allVisibleSelected ? "Снять выбор" : "Выбрать видимые"}</Button>
                <Button size="sm" variant="outline" disabled={!selected.size} onClick={() => run(() => patch({ ids: selectedIds, bulkOriginalTitle: true }))}><Check className="h-4 w-4" /> Название из папки</Button>
                <Input className="h-8 w-28" placeholder="Цена" value={bulkPrice} onChange={(e) => setBulkPrice(e.target.value)} />
                <Button size="sm" variant="outline" disabled={!selected.size || !bulkPrice} onClick={() => run(() => patch({ ids: selectedIds, bulkPrice }))}>Одна цена</Button>
                <Button size="sm" variant="destructive" disabled={!selected.size} onClick={() => run(() => patch({ ids: selectedIds, deleteSelected: true }))}><Trash2 className="h-4 w-4" /> Удалить</Button>
                <Button size="sm" disabled={status === "generating"} onClick={() => run(generateXml)}><Download className="h-4 w-4" /> XML</Button>
              </div>
              <div className="grid gap-1 text-xs text-muted-foreground lg:grid-cols-2">{session.progress.slice(-6).map((item, i) => <div key={i}>• {item}</div>)}</div>
            </CardContent></Card>
          )}

          <div className="grid gap-3 xl:grid-cols-2 2xl:grid-cols-3">
            {filtered.map((product) => (
              <Card key={product.id} className={product.deleted ? "opacity-45" : "cursor-pointer transition-colors hover:border-primary/25 hover:bg-accent/45"} onClick={() => openPreview(product)}>
                <CardContent className="flex gap-3 p-3">
                  <button className="mt-4 h-5 w-5 rounded border border-input text-xs" onClick={(e) => { e.stopPropagation(); toggle(product.index); }}>{selected.has(product.index) ? "✓" : ""}</button>
                  <button className="h-16 w-16 shrink-0 overflow-hidden rounded-md bg-muted" onClick={(e) => { e.stopPropagation(); openPreview(product); }}>
                    {product.firstPhoto && session ? <img src={photoUrl(session.id, product.firstPhoto)} alt="" className="h-full w-full object-cover" /> : <div className="flex h-full w-full items-center justify-center text-muted-foreground"><ImageIcon className="h-5 w-5" /></div>}
                  </button>
                  <div className="min-w-0 flex-1 space-y-2">
                    <div className="flex gap-2">
                      <div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold">#{product.index} {product.name}</p><p className="text-xs text-muted-foreground">{product.photoCount} фото · {formatRub(product.price)}</p></div>
                    </div>
                    <Input value={product.adTitle} disabled={product.useOriginalTitle || product.deleted} onClick={(e) => e.stopPropagation()} onChange={(e) => setSession((s) => s && ({ ...s, products: s.products.map((p) => p.index === product.index ? { ...p, adTitle: e.target.value } : p) }))} onBlur={() => run(() => patch({ products: [{ index: product.index, adTitle: product.adTitle }] }))} />
                    <div className="flex gap-2">
                      <Input inputMode="numeric" placeholder="Цена" value={product.price ?? ""} disabled={product.deleted} onClick={(e) => e.stopPropagation()} onChange={(e) => setSession((s) => s && ({ ...s, products: s.products.map((p) => p.index === product.index ? { ...p, price: e.target.value ? Number(e.target.value) : null } : p) }))} onBlur={() => run(() => patch({ products: [{ index: product.index, price: product.price }] }))} />
                      <Button size="icon" variant={product.useOriginalTitle ? "default" : "outline"} onClick={(e) => { e.stopPropagation(); run(() => patch({ products: [{ index: product.index, useOriginalTitle: !product.useOriginalTitle }] })); }}><Package className="h-4 w-4" /></Button>
                      <Button size="icon" variant="outline" onClick={(e) => { e.stopPropagation(); run(() => patch({ products: [{ index: product.index, deleted: !product.deleted }] })); }}>{product.deleted ? <X className="h-4 w-4" /> : <Trash2 className="h-4 w-4" />}</Button>
                    </div>
                    {product.photos.length > 1 && (
                      <div className="flex gap-1 overflow-x-auto pb-1" onClick={(e) => e.stopPropagation()}>
                        {product.photos.slice(0, 8).map((token, photoIndex) => (
                          <div key={token} className="relative h-14 w-14 shrink-0 overflow-hidden rounded-md border border-border bg-muted">
                            {session && <img src={photoUrl(session.id, token)} alt="" className="h-full w-full object-cover" />}
                            <span className="absolute left-1 top-1 rounded bg-background/85 px-1 text-[10px] font-semibold">{photoIndex + 1}</span>
                            <div className="absolute inset-x-0 bottom-0 flex justify-center gap-0.5 bg-background/80 p-0.5">
                              <button title="Сделать первой" className="rounded px-0.5" onClick={() => run(() => movePhoto(product, token, "first"))}><PanelTop className="h-3 w-3" /></button>
                              <button title="Сдвинуть влево" className="rounded px-0.5" onClick={() => run(() => movePhoto(product, token, "left"))}><ArrowLeft className="h-3 w-3" /></button>
                              <button title="Сдвинуть вправо" className="rounded px-0.5" onClick={() => run(() => movePhoto(product, token, "right"))}><ArrowRight className="h-3 w-3" /></button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </div>

      {preview && session && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-background/85 p-3 pt-6 backdrop-blur-sm sm:p-6" onClick={() => setPreview(null)}>
          <div className="w-full max-w-3xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-2 flex justify-end">
              <Button size="sm" variant="outline" onClick={() => setPreview(null)}><X className="h-4 w-4" /> Закрыть</Button>
            </div>
            <ListingPreview product={preview} sessionId={session.id} />
          </div>
        </div>
      )}

      {phonePromptOpen && session && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/85 p-4 backdrop-blur-sm" onClick={() => setPhonePromptOpen(false)}>
          <Card className="w-full max-w-md" onClick={(e) => e.stopPropagation()}>
            <CardContent className="space-y-4 p-5">
              <div>
                <p className="text-base font-semibold">Создать XML с другим телефоном?</p>
                <p className="mt-1 text-sm text-muted-foreground">Будет взят такой же XML, но номер телефона заменится во всех объявлениях.</p>
              </div>
              <Input placeholder="+7 999 000 00 00" value={replacementPhone} onChange={(e) => setReplacementPhone(e.target.value)} />
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setPhonePromptOpen(false)}>Не нужно</Button>
                <Button disabled={!replacementPhone.trim() || status === "generating"} onClick={() => run(async () => { await downloadXml(replacementPhone); setPhonePromptOpen(false); setReplacementPhone(""); })}>
                  {status === "generating" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                  Скачать
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
