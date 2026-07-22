"use client";

import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  Check,
  Download,
  ImagePlus,
  Images,
  Loader2,
  RefreshCw,
  Sparkles,
  Trash2,
  UploadCloud,
} from "lucide-react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/lib/hooks/use-toast";

type BackgroundSlot = "1" | "2" | "3";
type Background = {
  slot: BackgroundSlot;
  fileName: string | null;
  mimeType: string | null;
  size: number;
  updatedAt: string | null;
  url: string | null;
};
type ProductPhoto = { id: string; file: File; previewUrl: string };
type GenerationStatus = "queued" | "generating" | "ready" | "error";
type GenerationResult = {
  id: string;
  productId: string;
  productName: string;
  backgroundSlot: BackgroundSlot;
  status: GenerationStatus;
  dataUrl: string | null;
  mimeType: string | null;
  error: string | null;
  selected: boolean;
};

const slots: BackgroundSlot[] = ["1", "2", "3"];
const maxProducts = 10;

export function ContentMachineClient() {
  const [backgrounds, setBackgrounds] = useState<Background[]>(slots.map((slot) => emptyBackground(slot)));
  const [backgroundsLoading, setBackgroundsLoading] = useState(true);
  const [uploadingSlot, setUploadingSlot] = useState<BackgroundSlot | null>(null);
  const [products, setProducts] = useState<ProductPhoto[]>([]);
  const [results, setResults] = useState<GenerationResult[]>([]);
  const [imageSize, setImageSize] = useState<"2K" | "4K">("2K");
  const [generating, setGenerating] = useState(false);
  const productInputRef = useRef<HTMLInputElement>(null);
  const productUrlsRef = useRef<string[]>([]);

  useEffect(() => {
    void loadBackgrounds();
    return () => productUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
  }, []);

  async function loadBackgrounds() {
    setBackgroundsLoading(true);
    try {
      const response = await fetch("/api/ai/content-machine/backgrounds", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Не удалось загрузить фоны.");
      setBackgrounds(data.backgrounds);
    } catch (error) {
      toast({ title: "Фоны не загружены", description: errorMessage(error), variant: "destructive" });
    } finally {
      setBackgroundsLoading(false);
    }
  }

  async function uploadBackground(slot: BackgroundSlot, file: File | undefined) {
    if (!file) return;
    setUploadingSlot(slot);
    try {
      const form = new FormData();
      form.append("slot", slot);
      form.append("file", file);
      const response = await fetch("/api/ai/content-machine/backgrounds", { method: "POST", body: form });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Не удалось сохранить фон.");
      setBackgrounds((items) => items.map((item) => item.slot === slot ? data.background : item));
      setResults([]);
      toast({ title: `Фон ${slot} сохранён`, description: "Этот оригинал будет использоваться во всех следующих генерациях." });
    } catch (error) {
      toast({ title: "Ошибка загрузки", description: errorMessage(error), variant: "destructive" });
    } finally {
      setUploadingSlot(null);
    }
  }

  function addProducts(files: FileList | null) {
    if (!files) return;
    const available = maxProducts - products.length;
    const accepted = Array.from(files)
      .filter((file) => ["image/jpeg", "image/png", "image/webp"].includes(file.type) && file.size <= 20 * 1024 * 1024)
      .slice(0, available);
    if (accepted.length === 0) {
      toast({ title: "Не удалось добавить фото", description: "Используйте JPG, PNG или WebP до 20 МБ.", variant: "destructive" });
      return;
    }
    const added = accepted.map((file) => {
      const previewUrl = URL.createObjectURL(file);
      productUrlsRef.current.push(previewUrl);
      return { id: crypto.randomUUID(), file, previewUrl };
    });
    setProducts((items) => [...items, ...added]);
    setResults([]);
  }

  function removeProduct(id: string) {
    const product = products.find((item) => item.id === id);
    if (product) {
      URL.revokeObjectURL(product.previewUrl);
      productUrlsRef.current = productUrlsRef.current.filter((url) => url !== product.previewUrl);
    }
    setProducts((items) => items.filter((item) => item.id !== id));
    setResults((items) => items.filter((item) => item.productId !== id));
  }

  async function generateAll() {
    if (products.length === 0 || backgrounds.some((background) => !background.url)) return;
    const jobs = products.flatMap((product) => slots.map((slot) => createResult(product, slot)));
    setResults(jobs);
    setGenerating(true);
    let cursor = 0;
    const worker = async () => {
      while (cursor < jobs.length) {
        const job = jobs[cursor++];
        await generateOne(job);
      }
    };
    await Promise.all([worker(), worker()]);
    setGenerating(false);
  }

  async function generateOne(job: GenerationResult) {
    const product = products.find((item) => item.id === job.productId);
    if (!product) return;
    patchResult(job.id, { status: "generating", error: null, dataUrl: null, selected: false });
    try {
      const form = new FormData();
      form.append("product", product.file);
      form.append("backgroundSlot", job.backgroundSlot);
      form.append("imageSize", imageSize);
      const response = await fetch("/api/ai/content-machine/generate-image", { method: "POST", body: form });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Gemini не создал изображение.");
      patchResult(job.id, {
        status: "ready",
        dataUrl: `data:${data.mimeType || "image/jpeg"};base64,${data.data}`,
        mimeType: data.mimeType || "image/jpeg",
        error: null,
        selected: true,
      });
    } catch (error) {
      patchResult(job.id, { status: "error", error: errorMessage(error), dataUrl: null, selected: false });
    }
  }

  function patchResult(id: string, patch: Partial<GenerationResult>) {
    setResults((items) => items.map((item) => item.id === id ? { ...item, ...patch } : item));
  }

  function toggleSelected(id: string) {
    setResults((items) => items.map((item) => item.id === id && item.status === "ready" ? { ...item, selected: !item.selected } : item));
  }

  async function downloadResult(result: GenerationResult) {
    if (!result.dataUrl) return;
    const extension = result.mimeType === "image/jpeg" ? "jpg" : "png";
    const safeName = result.productName.replace(/\.[^.]+$/, "").replace(/[^a-zA-Zа-яА-ЯёЁ0-9_-]+/g, "-").slice(0, 60) || "product";
    const anchor = document.createElement("a");
    anchor.href = result.dataUrl;
    anchor.download = `${safeName}-background-${result.backgroundSlot}.${extension}`;
    anchor.click();
  }

  async function downloadSelected() {
    const selected = results.filter((result) => result.status === "ready" && result.selected);
    for (const result of selected) {
      await downloadResult(result);
      await new Promise((resolve) => setTimeout(resolve, 180));
    }
  }

  const allBackgroundsReady = backgrounds.every((background) => Boolean(background.url));
  const readyResults = results.filter((result) => result.status === "ready");
  const selectedCount = readyResults.filter((result) => result.selected).length;
  const completedCount = results.filter((result) => result.status === "ready" || result.status === "error").length;

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-30 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <div className="mx-auto flex h-16 w-full max-w-[100rem] items-center gap-3 px-4 sm:px-6 lg:px-8">
          <Link href="/settings" className="icon-tile h-9 w-9" aria-label="Назад в настройки">
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-lg font-semibold tracking-tight">Контент-машина</h1>
            <p className="hidden text-xs text-muted-foreground sm:block">Фотореалистичные карточки товара на трёх утверждённых фонах</p>
          </div>
          <Badge variant="outline" className="hidden sm:inline-flex">Gemini Images</Badge>
          <Select value={imageSize} onValueChange={(value: "2K" | "4K") => setImageSize(value)} disabled={generating}>
            <SelectTrigger className="h-9 w-24"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="2K">2K</SelectItem>
              <SelectItem value="4K">4K</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </header>

      <main className="content-machine-content mx-auto w-full max-w-[100rem] space-y-8 px-4 py-6 sm:px-6 lg:px-8">
        <section>
          <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h2 className="text-base font-semibold">Эталонные фоны</h2>
              <p className="mt-1 text-sm text-muted-foreground">Загрузите три оригинала один раз. Gemini не сможет выбирать другие фоны.</p>
            </div>
            <Badge variant={allBackgroundsReady ? "success" : "secondary"}>
              {backgrounds.filter((background) => background.url).length} из 3 загружено
            </Badge>
          </div>
          <div className="grid gap-3 md:grid-cols-3">
            {backgrounds.map((background) => (
              <BackgroundPanel
                key={background.slot}
                background={background}
                loading={backgroundsLoading || uploadingSlot === background.slot}
                onFile={(file) => void uploadBackground(background.slot, file)}
              />
            ))}
          </div>
        </section>

        <section>
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h2 className="text-base font-semibold">Исходные фото товара</h2>
              <p className="mt-1 text-sm text-muted-foreground">Добавьте все ракурсы одной вещи. Принт, пошив, цвет и видимая сторона сохраняются, а композиция может быть улучшена.</p>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">{products.length} фото → {products.length * 3} результатов</span>
              <Button variant="outline" size="sm" onClick={() => productInputRef.current?.click()} disabled={generating || products.length >= maxProducts}>
                <ImagePlus className="mr-1.5 h-4 w-4" />Добавить
              </Button>
            </div>
          </div>

          <input
            ref={productInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            multiple
            className="hidden"
            onChange={(event) => { addProducts(event.target.files); event.currentTarget.value = ""; }}
          />

          {products.length === 0 ? (
            <button
              type="button"
              onClick={() => productInputRef.current?.click()}
              className="flex min-h-52 w-full flex-col items-center justify-center rounded-xl border border-dashed border-border bg-secondary/20 px-6 text-center transition-colors hover:border-primary/45 hover:bg-secondary/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span className="icon-tile mb-3 h-11 w-11"><UploadCloud className="h-5 w-5" /></span>
              <span className="text-sm font-semibold">Загрузить фото товара</span>
              <span className="mt-1 text-xs text-muted-foreground">JPG, PNG или WebP до 20 МБ · максимум {maxProducts} ракурсов</span>
            </button>
          ) : (
            <div className="flex gap-3 overflow-x-auto pb-2">
              {products.map((product, index) => (
                <div key={product.id} className="group relative w-40 shrink-0 overflow-hidden rounded-lg border bg-card">
                  <div className="aspect-[4/5] bg-secondary/30">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={product.previewUrl} alt={`Исходное фото ${index + 1}`} className="h-full w-full object-cover" />
                  </div>
                  <div className="flex items-center justify-between gap-2 p-2">
                    <span className="min-w-0 truncate text-xs font-medium">{index + 1}. {product.file.name}</span>
                    <button type="button" onClick={() => removeProduct(product.id)} disabled={generating} className="text-muted-foreground hover:text-destructive disabled:opacity-40" aria-label="Удалить фото">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="mt-4 flex flex-col gap-3 rounded-lg border bg-card p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <Sparkles className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
              <div>
                <p className="text-sm font-semibold">Один исходник × три эталонных фона</p>
                <p className="mt-0.5 text-xs text-muted-foreground">Запускается отдельная генерация для каждой пары — так ракурсы не смешиваются между собой.</p>
              </div>
            </div>
            <Button onClick={() => void generateAll()} disabled={generating || products.length === 0 || !allBackgroundsReady} className="shrink-0">
              {generating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
              {generating ? `Готово ${completedCount} из ${results.length}` : `Создать ${products.length * 3} фото`}
            </Button>
          </div>
          {!allBackgroundsReady && <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">Перед запуском загрузите все три эталонных фона.</p>}
        </section>

        {results.length > 0 && (
          <section>
            <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <h2 className="text-base font-semibold">Результаты</h2>
                <p className="mt-1 text-sm text-muted-foreground">Отметьте удачные варианты, скачайте их или перезапустите отдельное фото.</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={readyResults.length === 0}
                  onClick={() => setResults((items) => items.map((item) => item.status === "ready" ? { ...item, selected: selectedCount !== readyResults.length } : item))}
                >
                  <Check className="mr-1.5 h-4 w-4" />{selectedCount === readyResults.length && readyResults.length ? "Снять выбор" : "Выбрать готовые"}
                </Button>
                <Button size="sm" disabled={selectedCount === 0} onClick={() => void downloadSelected()}>
                  <Download className="mr-1.5 h-4 w-4" />Скачать выбранные ({selectedCount})
                </Button>
              </div>
            </div>

            <div className="grid gap-5 xl:grid-cols-3">
              {slots.map((slot) => (
                <div key={slot} className="min-w-0">
                  <div className="mb-2 flex items-center justify-between">
                    <p className="text-sm font-semibold">Фон {slot}</p>
                    <span className="text-xs text-muted-foreground">{results.filter((result) => result.backgroundSlot === slot && result.status === "ready").length}/{products.length}</span>
                  </div>
                  <div className="space-y-3">
                    {results.filter((result) => result.backgroundSlot === slot).map((result) => (
                      <ResultPanel
                        key={result.id}
                        result={result}
                        disabled={generating}
                        onToggle={() => toggleSelected(result.id)}
                        onDownload={() => void downloadResult(result)}
                        onRegenerate={() => void generateOne(result)}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}
      </main>
    </div>
  );
}

function BackgroundPanel({ background, loading, onFile }: { background: Background; loading: boolean; onFile: (file: File | undefined) => void }) {
  const inputId = `background-upload-${background.slot}`;
  return (
    <Card className="overflow-hidden">
      <div className="relative aspect-[4/3] bg-secondary/35">
        {background.url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={background.url} alt={`Эталонный фон ${background.slot}`} className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full flex-col items-center justify-center text-muted-foreground">
            <Images className="mb-2 h-7 w-7 opacity-55" />
            <span className="text-xs">Фон не загружен</span>
          </div>
        )}
        {loading && <div className="absolute inset-0 flex items-center justify-center bg-background/70"><Loader2 className="h-5 w-5 animate-spin" /></div>}
        <Badge className="absolute left-3 top-3">Фон {background.slot}</Badge>
      </div>
      <CardContent className="flex items-center justify-between gap-3 p-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{background.fileName || "Добавьте оригинал"}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">{background.url ? formatBytes(background.size) : "JPG, PNG или WebP"}</p>
        </div>
        <Label htmlFor={inputId} className="inline-flex h-8 cursor-pointer items-center rounded-md border border-input bg-background px-3 text-xs font-medium hover:bg-accent">
          {background.url ? "Заменить" : "Загрузить"}
        </Label>
        <input id={inputId} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" disabled={loading} onChange={(event) => { onFile(event.target.files?.[0]); event.currentTarget.value = ""; }} />
      </CardContent>
    </Card>
  );
}

function ResultPanel({ result, disabled, onToggle, onDownload, onRegenerate }: {
  result: GenerationResult;
  disabled: boolean;
  onToggle: () => void;
  onDownload: () => void;
  onRegenerate: () => void;
}) {
  return (
    <div className={`overflow-hidden rounded-lg border bg-card ${result.selected ? "border-primary ring-1 ring-primary/30" : ""}`}>
      <div className="relative aspect-[4/5] bg-secondary/30">
        {result.dataUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={result.dataUrl} alt={`${result.productName}, фон ${result.backgroundSlot}`} className="h-full w-full object-contain" />
        ) : result.status === "error" ? (
          <div className="flex h-full flex-col items-center justify-center px-6 text-center">
            <p className="text-sm font-semibold text-destructive">Генерация не выполнена</p>
            <p className="mt-2 line-clamp-4 text-xs text-muted-foreground">{result.error}</p>
          </div>
        ) : (
          <div className="flex h-full flex-col items-center justify-center text-muted-foreground">
            {result.status === "generating" ? <Loader2 className="mb-2 h-6 w-6 animate-spin text-primary" /> : <Sparkles className="mb-2 h-6 w-6 opacity-45" />}
            <p className="text-xs">{result.status === "generating" ? "Gemini создаёт фото…" : "В очереди"}</p>
          </div>
        )}
        {result.status === "ready" && (
          <button type="button" onClick={onToggle} className={`absolute right-3 top-3 flex h-8 w-8 items-center justify-center rounded-md border shadow-sm ${result.selected ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background/90"}`} aria-label={result.selected ? "Снять выбор" : "Выбрать фото"}>
            <Check className="h-4 w-4" />
          </button>
        )}
      </div>
      <div className="flex items-center gap-2 p-3">
        <p className="min-w-0 flex-1 truncate text-xs font-medium">{result.productName}</p>
        {result.status === "ready" && <Button size="icon" variant="outline" className="h-8 w-8" onClick={onDownload} aria-label="Скачать"><Download className="h-3.5 w-3.5" /></Button>}
        {(result.status === "ready" || result.status === "error") && <Button size="icon" variant="outline" className="h-8 w-8" onClick={onRegenerate} disabled={disabled} aria-label="Создать заново"><RefreshCw className="h-3.5 w-3.5" /></Button>}
      </div>
    </div>
  );
}

function createResult(product: ProductPhoto, slot: BackgroundSlot): GenerationResult {
  return {
    id: `${product.id}:${slot}`,
    productId: product.id,
    productName: product.file.name,
    backgroundSlot: slot,
    status: "queued",
    dataUrl: null,
    mimeType: null,
    error: null,
    selected: false,
  };
}

function emptyBackground(slot: BackgroundSlot): Background {
  return { slot, fileName: null, mimeType: null, size: 0, updatedAt: null, url: null };
}

function formatBytes(bytes: number) {
  return bytes < 1024 * 1024 ? `${Math.round(bytes / 1024)} КБ` : `${(bytes / 1024 / 1024).toFixed(1)} МБ`;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
