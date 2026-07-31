"use client";

import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  Check,
  CircleCheck,
  Clock3,
  Download,
  Bug,
  ImagePlus,
  Images,
  Loader2,
  RefreshCw,
  ScanSearch,
  SlidersHorizontal,
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
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/lib/hooks/use-toast";
import {
  loadContentMachineDraft,
  saveContentMachineDraft,
} from "@/lib/client/content-machine-draft";
import {
  ContentMachineDiagnostics,
  type DiagnosticIncident,
} from "@/components/content-machine/content-machine-diagnostics";

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
  designNote?: string;
  labelStyleReference?: string;
  marketResearch?: {
    topSignals: string[];
    sourceCounts: Record<"grailed" | "mercari" | "rakuma", number>;
  };
  metaPromptSource?: "claude" | "fallback";
  metrics?: {
    totalDurationMs?: number;
    averageGenerationMs?: number;
    generations: Array<{ durationMs: number; uploadMs: number; generationMs: number }>;
  };
};

const slots: BackgroundSlot[] = ["1", "2", "3"];
const maxProducts = 10;
const maxDesignReferences = 6;

export function ContentMachineClient() {
  const [backgrounds, setBackgrounds] = useState<Background[]>(slots.map((slot) => emptyBackground(slot)));
  const [backgroundsLoading, setBackgroundsLoading] = useState(true);
  const [uploadingSlot, setUploadingSlot] = useState<BackgroundSlot | null>(null);
  const [products, setProducts] = useState<ProductPhoto[]>([]);
  const [imageSize, setImageSize] = useState<"2K" | "4K">("2K");
  const [mode, setMode] = useState<"product-photo" | "original-design">("product-photo");
  const [inspirationQuery, setInspirationQuery] = useState("");
  const [designNote, setDesignNote] = useState("");
  const [labelStyleReference, setLabelStyleReference] = useState("");
  const [job, setJob] = useState<FlowJob | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [creatingJob, setCreatingJob] = useState(false);
  const [refreshingJob, setRefreshingJob] = useState(false);
  const [retryingJob, setRetryingJob] = useState(false);
  const [refreshConfirmed, setRefreshConfirmed] = useState(false);
  const [resultRefreshKey, setResultRefreshKey] = useState(0);
  const [agentStatus, setAgentStatus] = useState<FlowAgentStatus | null>(null);
  const [diagnosticIncidents, setDiagnosticIncidents] = useState<DiagnosticIncident[]>([]);
  const [draftRestored, setDraftRestored] = useState(false);
  const productInputRef = useRef<HTMLInputElement>(null);
  const productUrlsRef = useRef<string[]>([]);
  const incidentFingerprintsRef = useRef(new Set<string>());

  useEffect(() => {
    void loadBackgrounds();
    void loadAgentStatus();
    void restoreDraft();
    const statusTimer = window.setInterval(() => void loadAgentStatus(), 5000);
    const savedJobId = window.localStorage.getItem("content-machine-flow-job");
    try {
      const savedIncidents = JSON.parse(window.localStorage.getItem("content-machine-diagnostic-incidents") || "[]") as DiagnosticIncident[];
      if (Array.isArray(savedIncidents)) {
        const valid = savedIncidents.filter((item) => item?.id && item?.action && item?.occurredAt).slice(0, 20);
        setDiagnosticIncidents(valid);
        valid.forEach((item) => incidentFingerprintsRef.current.add(`${item.action}:${item.technical}`));
      }
    } catch {
      window.localStorage.removeItem("content-machine-diagnostic-incidents");
    }
    if (savedJobId) void loadJob(savedJobId, false);
    const handleWindowError = (event: ErrorEvent) => reportIncident("Ошибка интерфейса", event.error || event.message);
    const handleUnhandledRejection = (event: PromiseRejectionEvent) => reportIncident("Необработанная ошибка", event.reason);
    window.addEventListener("error", handleWindowError);
    window.addEventListener("unhandledrejection", handleUnhandledRejection);
    return () => {
      window.clearInterval(statusTimer);
      window.removeEventListener("error", handleWindowError);
      window.removeEventListener("unhandledrejection", handleUnhandledRejection);
      productUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    };
  }, []);

  useEffect(() => {
    if (!draftRestored) return;
    const timer = window.setTimeout(() => {
      void saveContentMachineDraft({
        mode,
        imageSize,
        inspirationQuery,
        designNote,
        labelStyleReference,
        products: products.map(({ id, file }) => ({ id, file })),
        savedAt: new Date().toISOString(),
      }).catch((error) => reportIncident("Сохранение черновика", error));
    }, 350);
    return () => window.clearTimeout(timer);
  }, [draftRestored, mode, imageSize, inspirationQuery, designNote, labelStyleReference, products]);

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
      if (!response.ok) throw new Error(`[HTTP ${response.status}] ${data.error || "Не удалось загрузить фоны."}`);
      setBackgrounds(data.backgrounds);
    } catch (error) {
      reportIncident("Загрузка эталонных фонов", error);
    } finally {
      setBackgroundsLoading(false);
    }
  }

  async function loadAgentStatus() {
    try {
      const response = await fetch("/api/ai/content-machine/flow-agent/status", { cache: "no-store" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(`[HTTP ${response.status}] ${data.error || "Не удалось получить статус Flow."}`);
      setAgentStatus(data.status);
      if (!data.status?.online || data.status?.state !== "ready") {
        reportIncident("Flow-агент недоступен", `${data.status?.state || "offline"}: ${data.status?.message || "Агент не прислал актуальный статус."}`);
      }
    } catch (error) {
      setAgentStatus(null);
      reportIncident("Проверка Flow-агента", error);
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
      if (!response.ok) throw new Error(`[HTTP ${response.status}] ${data.error || "Не удалось сохранить фон."}`);
      setBackgrounds((items) => items.map((item) => item.slot === slot ? data.background : item));
      toast({ title: `Фон ${slot} сохранён`, description: "Этот оригинал будет использоваться во всех следующих генерациях." });
    } catch (error) {
      reportIncident(`Загрузка фона ${slot}`, error);
    } finally {
      setUploadingSlot(null);
    }
  }

  function addProducts(files: FileList | null) {
    if (!files) return;
    const limit = mode === "original-design" ? maxDesignReferences : maxProducts;
    const available = limit - products.length;
    const candidates = Array.from(files);
    const accepted = candidates
      .filter((file) => ["image/jpeg", "image/png", "image/webp"].includes(file.type) && file.size > 0 && file.size <= 20 * 1024 * 1024)
      .slice(0, available);
    if (accepted.length === 0) {
      reportIncident("Добавление исходного фото", "Файл имеет неподдерживаемый формат, пустой или превышает 20 МБ.");
      return;
    }
    if (accepted.length < candidates.length) {
      toast({
        title: "Часть файлов пропущена",
        description: `Добавлено ${accepted.length} из ${candidates.length}. Проверьте формат, размер до 20 МБ и лимит ракурсов.`,
      });
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
      if (mode === "original-design") {
        form.append("inspirationQuery", inspirationQuery.trim());
        form.append("designNote", designNote.trim());
        form.append("labelStyleReference", labelStyleReference.trim());
      }
      const response = await fetch("/api/ai/content-machine/codex-jobs", { method: "POST", body: form });
      const data = await response.json();
      if (!response.ok) throw new Error(`[HTTP ${response.status}] ${data.error || "Не удалось создать задание Flow."}`);
      setJob(data.job);
      setSelectedIds([]);
      window.localStorage.setItem("content-machine-flow-job", data.job.id);
      toast({ title: `Задание ${data.job.id} запущено`, description: "Локальный агент создаёт новые проекты Flow и автоматически забирает результаты." });
    } catch (error) {
      reportIncident("Создание задачи Flow", error);
    } finally {
      setCreatingJob(false);
    }
  }

  async function loadJob(id: string, showError = true) {
    try {
      const response = await fetch(`/api/ai/content-machine/codex-jobs/${encodeURIComponent(id)}`, { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(`[HTTP ${response.status}] ${data.error || "Не удалось обновить задание."}`);
      setJob(data.job);
      if (data.job.status === "failed" || Number(data.job.failedResults) > 0) {
        reportIncident(
          `Ошибка задачи ${data.job.id}`,
          data.job.error || `Flow не создал ${data.job.failedResults || 1} из ${data.job.expectedResults} изображений.`,
        );
      }
      if (data.job.status === "ready") setSelectedIds((items) => items.length ? items : data.job.results.map((result: FlowResult) => result.id));
      return true;
    } catch (error) {
      if (showError) reportIncident("Обновление задачи Flow", error);
      return false;
    }
  }

  async function restoreDraft() {
    try {
      const draft = await loadContentMachineDraft();
      if (!draft) return;
      setMode(draft.mode === "original-design" ? "original-design" : "product-photo");
      setImageSize(draft.imageSize === "4K" ? "4K" : "2K");
      setInspirationQuery(String(draft.inspirationQuery || "").slice(0, 120));
      setDesignNote(String(draft.designNote || "").slice(0, 1200));
      setLabelStyleReference(String(draft.labelStyleReference || "").slice(0, 100));
      const restoredProducts = (draft.products || [])
        .filter((item) => item?.file instanceof File)
        .slice(0, draft.mode === "original-design" ? maxDesignReferences : maxProducts)
        .map((item) => {
          const previewUrl = URL.createObjectURL(item.file);
          productUrlsRef.current.push(previewUrl);
          return { id: item.id || crypto.randomUUID(), file: item.file, previewUrl };
        });
      setProducts(restoredProducts);
      if (restoredProducts.length > 0) {
        toast({ title: "Черновик восстановлен", description: `Возвращено ${restoredProducts.length} исходных фото и заполненные поля.` });
      }
    } catch (error) {
      reportIncident("Восстановление черновика", error);
    } finally {
      setDraftRestored(true);
    }
  }

  async function refreshJob(id: string) {
    setRefreshingJob(true);
    setRefreshConfirmed(false);
    try {
      if (await loadJob(id)) {
        setResultRefreshKey((value) => value + 1);
        setRefreshConfirmed(true);
        window.setTimeout(() => setRefreshConfirmed(false), 2_500);
        toast({ title: "Результаты обновлены", description: "CRM получила актуальные файлы задачи." });
      }
    } finally {
      setRefreshingJob(false);
    }
  }

  async function retryJob(id: string) {
    setRetryingJob(true);
    try {
      const response = await fetch(`/api/ai/content-machine/codex-jobs/${encodeURIComponent(id)}/retry`, { method: "POST" });
      const data = await response.json();
      if (!response.ok) throw new Error(`[HTTP ${response.status}] ${data.error || "Не удалось повторить задачу."}`);
      setJob(data.job);
      toast({ title: "Задача возвращена в очередь", description: "Готовые фото сохранены; Flow создаст только недостающие." });
    } catch (error) {
      reportIncident("Повтор задачи Flow", error);
    } finally {
      setRetryingJob(false);
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

  function reportIncident(action: string, error: unknown) {
    const technical = errorMessage(error);
    const fingerprint = `${action}:${technical}`;
    if (incidentFingerprintsRef.current.has(fingerprint)) return;
    incidentFingerprintsRef.current.add(fingerprint);
    const diagnosis = diagnoseIncident(action, technical);
    const incident: DiagnosticIncident = {
      id: typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      occurredAt: new Date().toISOString(),
      action,
      cause: diagnosis.cause,
      resolution: diagnosis.resolution,
      technical,
    };
    setDiagnosticIncidents((items) => {
      const next = [incident, ...items].slice(0, 20);
      try {
        window.localStorage.setItem("content-machine-diagnostic-incidents", JSON.stringify(next));
      } catch {
        // The live journal still works in memory when storage is blocked.
      }
      return next;
    });
    toast({
      title: `Ошибка: ${action}`,
      description: `${diagnosis.cause} Что делать: ${diagnosis.resolution}`,
      variant: "destructive",
    });
  }

  function clearDiagnosticIncidents() {
    setDiagnosticIncidents([]);
    incidentFingerprintsRef.current.clear();
    window.localStorage.removeItem("content-machine-diagnostic-incidents");
  }

  const allBackgroundsReady = backgrounds.every((background) => Boolean(background.url));
  const readyResults = job?.results || [];
  const selectedCount = selectedIds.length;
  const designReady = mode === "product-photo" || inspirationQuery.trim().length >= 3;
  const resultCount = mode === "original-design" ? 3 : products.length * 3;

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-30 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <div className="mx-auto flex h-16 w-full max-w-[100rem] items-center gap-3 px-4 sm:px-6 lg:px-8">
          <Link href="/settings" className="icon-tile h-11 w-11" aria-label="Назад в настройки">
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
          <Button
            variant="outline"
            size="sm"
            className="hidden min-h-11 sm:inline-flex"
            onClick={() => document.getElementById("content-machine-diagnostics")?.scrollIntoView({ behavior: "smooth", block: "start" })}
          >
            <Bug className="mr-1.5 h-4 w-4" />Диагностика
          </Button>
          <Select value={imageSize} onValueChange={(value: "2K" | "4K") => setImageSize(value)} disabled={creatingJob}>
            <SelectTrigger className="h-11 w-24"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="2K">2K</SelectItem>
              <SelectItem value="4K">4K</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </header>

      <main className="content-machine-content mx-auto w-full min-w-0 max-w-[100rem] space-y-8 overflow-x-clip px-4 py-6 sm:px-6 lg:px-8">
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
                onImageError={() => reportIncident(`Отображение фона ${background.slot}`, `${background.fileName || "Файл"} не открылся в браузере.`)}
              />
            ))}
          </div>
        </section>

        <section>
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h2 className="text-base font-semibold">{mode === "original-design" ? "Фото залетевшей позиции" : "Исходные фото товара"}</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {mode === "original-design"
                  ? "Добавьте перед, спину и детали одной залетевшей позиции. Все фото считаются ракурсами одного товара и помогают понять принты с обеих сторон."
                  : "Добавьте все ракурсы одной вещи. Принт, пошив, цвет и видимая сторона сохраняются, а композиция может быть улучшена."}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">{products.length} фото → {resultCount} результата</span>
              <Button variant="outline" size="sm" className="min-h-11" onClick={() => productInputRef.current?.click()} disabled={creatingJob || products.length >= (mode === "original-design" ? maxDesignReferences : maxProducts)}>
                <ImagePlus className="mr-1.5 h-4 w-4" />Добавить
              </Button>
            </div>
          </div>

          <details className="mb-4 rounded-lg border bg-card">
            <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 px-4 py-3 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground">
              <SlidersHorizontal className="h-4 w-4" />
              Параметры генерации
              <span className="ml-auto text-xs opacity-75">
                {mode === "original-design" ? "Новый дизайн" : "Карточка товара"} · {imageSize}
              </span>
            </summary>
            <div className="grid gap-3 border-t border-border/80 p-4 lg:grid-cols-[18rem_minmax(0,1fr)]">
              <div>
                <Label htmlFor="content-mode">Режим</Label>
                <Select
                  value={mode}
                  onValueChange={(value: "product-photo" | "original-design") => setMode(value)}
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
                <>
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
                  <div>
                    <Label htmlFor="label-style-reference">Стиль бирки / бренд-референс</Label>
                    <Input
                      id="label-style-reference"
                      value={labelStyleReference}
                      onChange={(event) => setLabelStyleReference(event.target.value)}
                      placeholder="Например: минималистичный архивный люкс"
                      maxLength={100}
                      className="mt-1.5 h-11"
                      disabled={creatingJob}
                    />
                    <p className="mt-1.5 text-xs text-muted-foreground">Flow сделает оригинальную термобирку CUSTOM MADE в указанной эстетике, без чужого названия или логотипа.</p>
                  </div>
                  <div className="lg:col-span-2">
                    <Label htmlFor="design-note">Примечание</Label>
                    <Textarea
                      id="design-note"
                      value={designNote}
                      onChange={(event) => setDesignNote(event.target.value)}
                      placeholder={"Например:\nДай 3 фото с разных ракурсов\nРисунок меньше"}
                      maxLength={1200}
                      rows={3}
                      className="mt-1.5 min-h-24 resize-y"
                      disabled={creatingJob}
                    />
                    <p className="mt-1.5 text-xs text-muted-foreground">Claude учтёт пожелания при создании финального мета-промпта для Flow.</p>
                  </div>
                </>
              ) : (
                <div className="flex items-center text-sm text-muted-foreground">
                  Товар останется неизменным, агент заменит только фон и сведёт свет.
                </div>
              )}
            </div>
          </details>

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
              <span className="text-sm font-semibold">{mode === "original-design" ? "Загрузить фото залетевшей позиции" : "Загрузить фото товара"}</span>
              <span className="mt-1 text-xs text-muted-foreground">JPG, PNG или WebP до 20 МБ · максимум {mode === "original-design" ? maxDesignReferences : maxProducts} ракурсов одного товара</span>
            </button>
          ) : (
            <div className="flex gap-3 overflow-x-auto pb-2">
              {products.map((product, index) => (
                <div key={product.id} className="group relative w-40 shrink-0 overflow-hidden rounded-lg border bg-card">
                  <div className="aspect-[4/5] bg-secondary/30">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={product.previewUrl}
                      alt={`Исходное фото ${index + 1}`}
                      className="h-full w-full object-cover"
                      onError={() => reportIncident(`Отображение исходного фото ${index + 1}`, `${product.file.name}: браузер не смог открыть изображение.`)}
                    />
                  </div>
                  <div className="flex items-center justify-between gap-2 p-2">
                    <span className="min-w-0 truncate text-xs font-medium">{index + 1}. {product.file.name}</span>
                    <button type="button" onClick={() => removeProduct(product.id)} disabled={creatingJob} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive disabled:opacity-40" aria-label="Удалить фото">
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
            <Button onClick={() => void createJob()} disabled={creatingJob || products.length === 0 || !allBackgroundsReady || !designReady} className="min-h-11 w-full shrink-0 sm:w-auto">
              {creatingJob ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
              {creatingJob ? "Ставлю в очередь Flow…" : `Создать ${resultCount} фото`}
            </Button>
          </div>
          {agentStatus && (!agentStatus.online || agentStatus.state !== "ready") && (
            <p className="mt-2 text-xs text-warning">{agentStatus.message} Статус агента не блокирует постановку задания в очередь.</p>
          )}
          {!allBackgroundsReady && <p className="mt-2 text-xs text-warning">Перед запуском загрузите все три эталонных фона.</p>}
        </section>

        {job && (
          <section>
            {job.marketResearch && (
              <div className="mb-4 rounded-lg border bg-card p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <ScanSearch className="h-4 w-4 text-primary" />
                  <h2 className="text-sm font-semibold">Рынок изучен</h2>
                  {job.metaPromptSource === "claude" && <Badge variant="success">Мета-промпт Claude</Badge>}
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
                    {job.status === "ready" ? <CircleCheck className="h-5 w-5 text-success" /> : <Clock3 className="h-5 w-5 text-primary" />}
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
                  {job.status === "failed" && (
                    <Button size="sm" className="min-h-11" disabled={retryingJob} onClick={() => void retryJob(job.id)}>
                      {retryingJob ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-1.5 h-4 w-4" />}
                      {retryingJob ? "Возвращаю в очередь…" : "Повторить недостающие"}
                    </Button>
                  )}
                  <Button variant="outline" size="sm" className="min-h-11" disabled={refreshingJob} onClick={() => void refreshJob(job.id)}>
                    {refreshConfirmed
                      ? <Check className="mr-1.5 h-4 w-4 text-success" />
                      : <RefreshCw className={`mr-1.5 h-4 w-4 ${refreshingJob ? "animate-spin" : ""}`} />}
                    {refreshingJob ? "Обновляю…" : refreshConfirmed ? "Обновлено" : "Обновить"}
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
                  className="min-h-11"
                  disabled={readyResults.length === 0}
                  onClick={() => setSelectedIds(selectedCount === readyResults.length ? [] : readyResults.map((item) => item.id))}
                >
                  <Check className="mr-1.5 h-4 w-4" />{selectedCount === readyResults.length && readyResults.length ? "Снять выбор" : "Выбрать готовые"}
                </Button>
                <Button size="sm" className="min-h-11" disabled={selectedCount === 0} onClick={() => void downloadSelected()}>
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
                        refreshKey={resultRefreshKey}
                        onImageError={() => reportIncident(`Отображение результата ${result.fileName}`, `${result.url}: изображение не загрузилось.`)}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
            </>}
          </section>
        )}
        <ContentMachineDiagnostics
          backgrounds={backgrounds}
          products={products}
          agentStatus={agentStatus}
          job={job}
          incidents={diagnosticIncidents}
          onClearIncidents={clearDiagnosticIncidents}
        />
      </main>
    </div>
  );
}

function BackgroundPanel({ background, loading, onFile, onImageError }: {
  background: Background;
  loading: boolean;
  onFile: (file: File | undefined) => void;
  onImageError: () => void;
}) {
  const inputId = `background-upload-${background.slot}`;
  return (
    <Card className="overflow-hidden">
      <div className="relative aspect-[4/3] bg-secondary/35">
        {background.url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={background.url} alt={`Эталонный фон ${background.slot}`} className="h-full w-full object-cover" onError={onImageError} />
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
        <Label htmlFor={inputId} className="inline-flex h-11 cursor-pointer items-center rounded-md border border-input bg-background px-3 text-xs font-medium hover:bg-accent">
          {background.url ? "Заменить" : "Загрузить"}
        </Label>
        <input id={inputId} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" disabled={loading} onChange={(event) => { onFile(event.target.files?.[0]); event.currentTarget.value = ""; }} />
      </CardContent>
    </Card>
  );
}

function ResultPanel({ result, selected, onToggle, onDownload, refreshKey, onImageError }: {
  result: FlowResult;
  selected: boolean;
  onToggle: () => void;
  onDownload: () => void;
  refreshKey: number;
  onImageError: () => void;
}) {
  return (
    <div className={`overflow-hidden rounded-lg border bg-card ${selected ? "border-primary ring-1 ring-primary/30" : ""}`}>
      <div className="relative min-h-32 bg-secondary/30">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={`${result.url}${result.url.includes("?") ? "&" : "?"}refresh=${refreshKey}`}
          alt={`${result.productName}, фон ${result.backgroundSlot}`}
          className="block h-auto w-full"
          loading="lazy"
          onError={onImageError}
        />
        <button type="button" onClick={onToggle} className={`absolute right-3 top-3 flex h-11 w-11 items-center justify-center rounded-md border shadow-sm ${selected ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background/90"}`} aria-label={selected ? "Снять выбор" : "Выбрать фото"}>
          <Check className="h-4 w-4" />
        </button>
      </div>
      <div className="flex items-center gap-2 p-3">
        <p className="min-w-0 flex-1 truncate text-xs font-medium">{result.productName}</p>
        <Button size="icon" variant="outline" className="h-11 w-11" onClick={onDownload} aria-label="Скачать"><Download className="h-4 w-4" /></Button>
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

function diagnoseIncident(action: string, technical: string) {
  const text = `${action} ${technical}`.toLowerCase();
  if (text.includes("401") || text.includes("не авторизован")) {
    return {
      cause: "Сессия сотрудника закончилась или вход в CRM потерян.",
      resolution: "Обновите страницу и войдите в CRM заново, затем повторите действие.",
    };
  }
  if (text.includes("403") || text.includes("недостаточно прав")) {
    return {
      cause: "У текущего пользователя нет прав на это действие.",
      resolution: "Войдите под администратором или попросите владельца CRM проверить роль сотрудника.",
    };
  }
  if (text.includes("20 мб") || text.includes("формат") || text.includes("разрешены jpg")) {
    return {
      cause: "Файл пустой, слишком большой или имеет неподдерживаемый формат.",
      resolution: "Используйте JPG, PNG или WebP размером до 20 МБ и загрузите файл повторно.",
    };
  }
  if (text.includes("watermark") || text.includes("водян")) {
    return {
      cause: "Google Flow обнаружил водяной знак на одном из референсов и отклонил файл.",
      resolution: "Замените проблемное фото оригиналом без водяного знака и нажмите «Повторить недостающие». Уже готовые результаты сохранятся.",
    };
  }
  if (text.includes("авторск") || text.includes("content policy") || text.includes("policy violation")) {
    return {
      cause: "Google Flow отклонил референс по правилам контента или авторских прав.",
      resolution: "Используйте собственное фото без чужих логотипов и нажмите «Повторить недостающие».",
    };
  }
  if (text.includes("регион") || text.includes("blocked")) {
    return {
      cause: "Google Flow заблокирован для текущего региона или подключения.",
      resolution: "Проверьте прокси Flow-агента и повторите запуск после появления статуса «Flow онлайн».",
    };
  }
  if (text.includes("вход") || text.includes("auth_required")) {
    return {
      cause: "Локальный Flow-агент потерял авторизацию Google.",
      resolution: "Откройте профиль Flow-агента, войдите в Google и дождитесь статуса «Flow онлайн».",
    };
  }
  if (text.includes("fetch") || text.includes("network") || text.includes("сеть")) {
    return {
      cause: "Браузер не смог связаться с CRM или соединение оборвалось.",
      resolution: "Проверьте интернет, обновите страницу и повторите действие. Если ошибка останется — отправьте технические детали владельцу.",
    };
  }
  if (text.includes("изображ") || text.includes("фото") || text.includes("фон")) {
    return {
      cause: "Файл изображения отсутствует, повреждён или недоступен браузеру.",
      resolution: "Перезагрузите страницу. Если файл не появился — загрузите исходник/фон снова или обновите результаты задачи.",
    };
  }
  if (text.includes("flow") || text.includes("задач")) {
    return {
      cause: "CRM или локальный Flow-агент не смогли выполнить операцию с задачей.",
      resolution: "Проверьте статус Flow вверху страницы, нажмите «Обновить». Если не поможет — скопируйте эту ошибку и отправьте владельцу.",
    };
  }
  return {
    cause: "Во время работы произошла непредвиденная техническая ошибка.",
    resolution: "Повторите действие один раз. Если ошибка повторится — нажмите «Скопировать последнюю» и отправьте владельцу вместе со скриншотом.",
  };
}
