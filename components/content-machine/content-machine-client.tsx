"use client";

import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  Check,
  CircleCheck,
  Clock3,
  Download,
  ImagePlus,
  Images,
  Loader2,
  RefreshCw,
  ScanSearch,
  Sparkles,
  Trash2,
  UploadCloud,
} from "lucide-react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
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
type FlowAgentStatus = {
  state: "ready" | "blocked" | "auth_required" | "error";
  message: string;
  online: boolean;
  concurrency: number;
};
type FlowResult = {
  id: string;
  productIndex: number;
  productName: string;
  backgroundSlot: BackgroundSlot;
  fileName: string;
  mimeType: string;
  size: number;
  url: string;
};
type FlowJob = {
  id: string;
  createdAt: string;
  imageSize: "2K" | "4K";
  status: "waiting" | "partial" | "ready" | "failed";
  expectedResults: number;
  failedResults?: number;
  results: FlowResult[];
  error?: string;
  mode?: "product-photo" | "original-design";
  inspirationQuery?: string;
  marketResearch?: {
    topSignals: string[];
    sourceCounts: Record<"grailed" | "mercari" | "rakuma", number>;
  };
  metrics?: {
    totalDurationMs?: number;
    averageGenerationMs?: number;
    generations: Array<{ durationMs: number; uploadMs: number; generationMs: number }>;
  };
};

const slots: BackgroundSlot[] = ["1", "2", "3"];
const maxProducts = 10;

export function ContentMachineClient() {
  const [backgrounds, setBackgrounds] = useState<Background[]>(slots.map((slot) => emptyBackground(slot)));
  const [backgroundsLoading, setBackgroundsLoading] = useState(true);
  const [uploadingSlot, setUploadingSlot] = useState<BackgroundSlot | null>(null);
  const [products, setProducts] = useState<ProductPhoto[]>([]);
  const [imageSize, setImageSize] = useState<"2K" | "4K">("2K");
  const [mode, setMode] = useState<"product-photo" | "original-design">("product-photo");
  const [inspirationQuery, setInspirationQuery] = useState("");
  const [job, setJob] = useState<FlowJob | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [creatingJob, setCreatingJob] = useState(false);
  const [agentStatus, setAgentStatus] = useState<FlowAgentStatus | null>(null);
  const productInputRef = useRef<HTMLInputElement>(null);
  const productUrlsRef = useRef<string[]>([]);

  useEffect(() => {
    void loadBackgrounds();
    void loadAgentStatus();
    const statusTimer = window.setInterval(() => void loadAgentStatus(), 5000);
    const savedJobId = window.localStorage.getItem("content-machine-flow-job");
    if (savedJobId) void loadJob(savedJobId, false);
    return () => {
      window.clearInterval(statusTimer);
      productUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    };
  }, []);

  useEffect(() => {
    if (!job || job.status === "ready" || job.status === "failed") return;
    const timer = window.setInterval(() => void loadJob(job.id, false), 2000);
    return () => window.clearInterval(timer);
  }, [job?.id, job?.status]);

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

  async function loadAgentStatus() {
    try {
      const response = await fetch("/api/ai/content-machine/flow-agent/status", { cache: "no-store" });
      if (!response.ok) return;
      const data = await response.json();
      setAgentStatus(data.status);
    } catch {
      setAgentStatus(null);
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
      toast({ title: `Фон ${slot} сохранён`, description: "Этот оригинал будет использоваться во всех следующих генерациях." });
    } catch (error) {
      toast({ title: "Ошибка загрузки", description: errorMessage(error), variant: "destructive" });
    } finally {
      setUploadingSlot(null);
    }
  }

  function addProducts(files: FileList | null) {
    if (!files) return;
    const limit = mode === "original-design" ? 1 : maxProducts;
    const available = limit - products.length;
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
  }

  function removeProduct(id: string) {
    const product = products.find((item) => item.id === id);
    if (product) {
      URL.revokeObjectURL(product.previewUrl);
      productUrlsRef.current = productUrlsRef.current.filter((url) => url !== product.previewUrl);
    }
    setProducts((items) => items.filter((item) => item.id !== id));
  }

  async function createJob() {
    if (products.length === 0 || backgrounds.some((background) => !background.url)) return;
    setCreatingJob(true);
    try {
      const form = new FormData();
      products.forEach((product) => form.append("products", product.file));
      form.append("imageSize", imageSize);
      form.append("mode", mode);
      if (mode === "original-design") form.append("inspirationQuery", inspirationQuery.trim());
      const response = await fetch("/api/ai/content-machine/codex-jobs", { method: "POST", body: form });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Не удалось создать задание Flow.");
      setJob(data.job);
      setSelectedIds([]);
      window.localStorage.setItem("content-machine-flow-job", data.job.id);
      toast({ title: `Задание ${data.job.id} запущено`, description: "Локальный агент создаёт новые проекты Flow и автоматически забирает результаты." });
    } catch (error) {
      toast({ title: "Задание не создано", description: errorMessage(error), variant: "destructive" });
    } finally {
      setCreatingJob(false);
    }
  }

  async function loadJob(id: string, showError = true) {
    try {
      const response = await fetch(`/api/ai/content-machine/codex-jobs/${encodeURIComponent(id)}`, { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Не удалось обновить задание.");
      setJob(data.job);
      if (data.job.status === "ready") setSelectedIds((items) => items.length ? items : data.job.results.map((result: FlowResult) => result.id));
    } catch (error) {
      if (showError) toast({ title: "Задание не найдено", description: errorMessage(error), variant: "destructive" });
    }
  }

  function toggleSelected(id: string) {
    setSelectedIds((items) => items.includes(id) ? items.filter((item) => item !== id) : [...items, id]);
  }

  async function downloadResult(result: FlowResult) {
    const anchor = document.createElement("a");
    anchor.href = result.url;
    anchor.download = result.fileName;
    anchor.click();
  }

  async function downloadSelected() {
    const selected = job?.results.filter((result) => selectedIds.includes(result.id)) || [];
    for (const result of selected) {
      await downloadResult(result);
      await new Promise((resolve) => setTimeout(resolve, 180));
    }
  }

  const allBackgroundsReady = backgrounds.every((background) => Boolean(background.url));
  const agentReady = Boolean(agentStatus?.online && agentStatus.state === "ready");
  const readyResults = job?.results || [];
  const selectedCount = selectedIds.length;
  const designReady = mode === "product-photo" || inspirationQuery.trim().length >= 3;

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
          <Badge
            variant={agentStatus?.online && agentStatus.state === "ready" ? "success" : "outline"}
            className="hidden sm:inline-flex"
            title={agentStatus?.message}
          >
            {agentStatus?.online && agentStatus.state === "ready"
              ? `Flow онлайн · ${agentStatus.concurrency} потока`
              : agentStatus?.state === "blocked"
                ? "Flow: регион заблокирован"
                : agentStatus?.state === "auth_required"
                  ? "Flow: нужен вход"
                  : "Flow-агент офлайн"}
          </Badge>
          <Select value={imageSize} onValueChange={(value: "2K" | "4K") => setImageSize(value)} disabled={creatingJob}>
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
              <p className="mt-1 text-sm text-muted-foreground">Загрузите три утверждённых примера один раз. В каждое задание попадёт их отдельная копия.</p>
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
              <Button variant="outline" size="sm" onClick={() => productInputRef.current?.click()} disabled={creatingJob || products.length >= maxProducts}>
                <ImagePlus className="mr-1.5 h-4 w-4" />Добавить
              </Button>
            </div>
          </div>

          <div className="mb-4 grid gap-3 rounded-lg border bg-card p-4 lg:grid-cols-[18rem_minmax(0,1fr)]">
            <div>
              <Label htmlFor="content-mode">Режим</Label>
              <Select
                value={mode}
                onValueChange={(value: "product-photo" | "original-design") => {
                  if (value === "original-design" && products.length > 1) {
                    products.slice(1).forEach((product) => URL.revokeObjectURL(product.previewUrl));
                    setProducts((items) => items.slice(0, 1));
                    toast({ title: "Оставлено первое фото", description: "Для нового дизайна нужен один пример залетевшей позиции." });
                  }
                  setMode(value);
                }}
                disabled={creatingJob}
              >
                <SelectTrigger id="content-mode" className="mt-1.5 h-11"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="product-photo">Карточка существующего товара</SelectItem>
                  <SelectItem value="original-design">Новый дизайн по залетевшей позиции</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {mode === "original-design" ? (
              <div>
                <Label htmlFor="inspiration-query">Что сравнить на площадках</Label>
                <div className="relative mt-1.5">
                  <ScanSearch className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-muted-foreground" />
                  <Input
                    id="inspiration-query"
                    value={inspirationQuery}
                    onChange={(event) => setInspirationQuery(event.target.value)}
                    placeholder="Например: vintage gothic long sleeve, washed black"
                    maxLength={120}
                    className="h-11 pl-9"
                    disabled={creatingJob}
                  />
                </div>
                <p className="mt-1.5 text-xs text-muted-foreground">Агент сравнит Grailed, Mercari и Rakuma и выделит общие приёмы без копирования конкретного принта.</p>
              </div>
            ) : (
              <div className="flex items-center text-sm text-muted-foreground">
                Товар останется неизменным, агент заменит только фон и сведёт свет.
              </div>
            )}
          </div>

          <input
            ref={productInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            multiple={mode === "product-photo"}
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
              <span className="text-sm font-semibold">{mode === "original-design" ? "Загрузить фото залетевшей позиции" : "Загрузить фото товара"}</span>
              <span className="mt-1 text-xs text-muted-foreground">JPG, PNG или WebP до 20 МБ · {mode === "original-design" ? "одно фото футболки или лонгслива" : `максимум ${maxProducts} ракурсов`}</span>
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
                    <button type="button" onClick={() => removeProduct(product.id)} disabled={creatingJob} className="text-muted-foreground hover:text-destructive disabled:opacity-40" aria-label="Удалить фото">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="mt-4 flex flex-col gap-4 rounded-lg border bg-card p-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-start gap-3">
              <Sparkles className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
              <div>
                <p className="text-sm font-semibold">{mode === "original-design" ? "Исследовать рынок и создать оригинальные варианты" : "Запустить быстрый локальный агент Flow"}</p>
                <p className="mt-0.5 max-w-2xl text-xs text-muted-foreground">
                  {mode === "original-design"
                    ? "Агент разберёт фото-победитель, сравнит выдачу трёх площадок, соберёт общий тренд-промпт и вернёт три самостоятельных дизайна в CRM."
                    : "Агент сам откроет отдельный проект Flow для каждого результата, загрузит оба референса, вставит промпт и сохранит готовое фото в CRM."}
                </p>
              </div>
            </div>
            <Button onClick={() => void createJob()} disabled={creatingJob || products.length === 0 || !allBackgroundsReady || !designReady || (agentStatus !== null && !agentReady)} className="shrink-0">
              {creatingJob ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
              {creatingJob ? "Ставлю в очередь Flow…" : `Создать ${products.length * 3} фото`}
            </Button>
          </div>
          {agentStatus && (!agentStatus.online || agentStatus.state !== "ready") && (
            <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">{agentStatus.message}</p>
          )}
          {!allBackgroundsReady && <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">Перед запуском загрузите все три эталонных фона.</p>}
        </section>

        {job && (
          <section>
            {job.marketResearch && (
              <div className="mb-4 rounded-lg border bg-card p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <ScanSearch className="h-4 w-4 text-primary" />
                  <h2 className="text-sm font-semibold">Рынок изучен</h2>
                  {(["grailed", "mercari", "rakuma"] as const).map((source) => (
                    <Badge key={source} variant="secondary" className="capitalize">
                      {source} · {job.marketResearch?.sourceCounts[source] || 0}
                    </Badge>
                  ))}
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                  Сигналы: {job.marketResearch.topSignals.length ? job.marketResearch.topSignals.join(", ") : "выдача площадок не дала устойчивых повторов; агент использовал фото-победитель"}
                </p>
              </div>
            )}
            <div className="mb-5 rounded-lg border bg-card p-4 sm:p-5">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                <div className="flex min-w-0 items-start gap-3">
                  <span className="icon-tile h-10 w-10">
                    {job.status === "ready" ? <CircleCheck className="h-5 w-5 text-emerald-600" /> : <Clock3 className="h-5 w-5 text-primary" />}
                  </span>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="font-mono text-sm font-semibold">{job.id}</h2>
                      <Badge variant={job.status === "ready" ? "success" : "secondary"}>
                        {job.status === "ready"
                          ? "Готово"
                          : job.status === "failed"
                            ? "Ошибка агента"
                            : job.status === "partial"
                              ? `Готово ${job.results.length} из ${job.expectedResults}`
                              : "Локальный агент Flow работает"}
                      </Badge>
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {job.status === "ready"
                        ? "Все изображения загружены в CRM."
                        : job.status === "failed"
                          ? job.error || `Готово ${job.results.length} из ${job.expectedResults}. Проверьте журнал локального агента.`
                          : "Статус обновляется автоматически; каждое фото создаётся в новом проекте Flow."}
                    </p>
                    {job.metrics?.generations.length ? (
                      <p className="mt-1 text-xs text-muted-foreground">
                        Среднее фото: {formatDuration(job.metrics.averageGenerationMs || average(job.metrics.generations.map((item) => item.durationMs)))}
                        {job.metrics.totalDurationMs ? ` · всё за ${formatDuration(job.metrics.totalDurationMs)}` : ""}
                      </p>
                    ) : null}
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" size="sm" onClick={() => void loadJob(job.id)}>
                    <RefreshCw className="mr-1.5 h-4 w-4" />Обновить
                  </Button>
                </div>
              </div>
            </div>

            {readyResults.length > 0 && <>
              <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <h2 className="text-base font-semibold">Результаты</h2>
                  <p className="mt-1 text-sm text-muted-foreground">Отметьте удачные варианты и скачайте их.</p>
                </div>
                <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={readyResults.length === 0}
                  onClick={() => setSelectedIds(selectedCount === readyResults.length ? [] : readyResults.map((item) => item.id))}
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
                    <span className="text-xs text-muted-foreground">{readyResults.filter((result) => result.backgroundSlot === slot).length}/{job.expectedResults / 3}</span>
                  </div>
                  <div className="space-y-3">
                    {readyResults.filter((result) => result.backgroundSlot === slot).map((result) => (
                      <ResultPanel
                        key={result.id}
                        result={result}
                        selected={selectedIds.includes(result.id)}
                        onToggle={() => toggleSelected(result.id)}
                        onDownload={() => void downloadResult(result)}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
            </>}
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

function ResultPanel({ result, selected, onToggle, onDownload }: {
  result: FlowResult;
  selected: boolean;
  onToggle: () => void;
  onDownload: () => void;
}) {
  return (
    <div className={`overflow-hidden rounded-lg border bg-card ${selected ? "border-primary ring-1 ring-primary/30" : ""}`}>
      <div className="relative aspect-[4/5] bg-secondary/30">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={result.url} alt={`${result.productName}, фон ${result.backgroundSlot}`} className="h-full w-full object-contain" />
        <button type="button" onClick={onToggle} className={`absolute right-3 top-3 flex h-8 w-8 items-center justify-center rounded-md border shadow-sm ${selected ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background/90"}`} aria-label={selected ? "Снять выбор" : "Выбрать фото"}>
          <Check className="h-4 w-4" />
        </button>
      </div>
      <div className="flex items-center gap-2 p-3">
        <p className="min-w-0 flex-1 truncate text-xs font-medium">{result.productName}</p>
        <Button size="icon" variant="outline" className="h-8 w-8" onClick={onDownload} aria-label="Скачать"><Download className="h-3.5 w-3.5" /></Button>
      </div>
    </div>
  );
}

function emptyBackground(slot: BackgroundSlot): Background {
  return { slot, fileName: null, mimeType: null, size: 0, updatedAt: null, url: null };
}

function formatBytes(bytes: number) {
  return bytes < 1024 * 1024 ? `${Math.round(bytes / 1024)} КБ` : `${(bytes / 1024 / 1024).toFixed(1)} МБ`;
}

function average(values: number[]) {
  return values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length) : 0;
}

function formatDuration(ms: number) {
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} сек`;
  return `${Math.floor(ms / 60_000)} мин ${Math.round((ms % 60_000) / 1000)} сек`;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
