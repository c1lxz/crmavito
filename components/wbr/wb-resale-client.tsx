"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  FileUp,
  ImagePlus,
  Loader2,
  Octagon,
  Play,
  RefreshCw,
  Store,
  Trash2,
  UploadCloud,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";

const AGENT_URL = "http://127.0.0.1:3017";
const AGENT_VERSION = "2026.07.27.3";
const SIZE_GUIDE_URL = "https://crmavito.duckdns.org/assets/ky-strok-size-guide-v2.jpg";
const SIZES = ["XXS", "XS", "S", "M", "L", "XL", "2XL"];
const DEFAULT_PICKUP_POINT = "Москва, Новоспасский Переулок 3к2";

type AgentStatus = "online" | "offline";

interface Listing {
  sku: string;
  title: string;
  price: number;
  photos: string;
  characteristics: string;
  status: string;
  note: string;
  listing_url?: string;
}

interface RpaEvent {
  time?: string;
  type?: string;
  id?: string;
  status?: string;
  level?: string;
  message?: string;
  screenshot?: string;
}

interface UploadedPhoto {
  path: string;
  preview: string;
  name?: string;
}

const statusLabels: Record<string, string> = {
  draft: "Черновик",
  ready: "К публикации",
  exported: "Выгружено",
  running: "В работе",
  moderation: "На проверке",
  posted: "Опубликовано",
  error: "Ошибка",
};

export function WbResaleClient() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const xmlInputRef = useRef<HTMLInputElement>(null);
  const [agentStatus, setAgentStatus] = useState<AgentStatus>("offline");
  const [rpaRunning, setRpaRunning] = useState(false);
  const [agentVersion, setAgentVersion] = useState("");
  const [listings, setListings] = useState<Listing[]>([]);
  const [events, setEvents] = useState<RpaEvent[]>([]);
  const [photos, setPhotos] = useState<UploadedPhoto[]>([]);
  const [sizes, setSizes] = useState(SIZES);
  const [saving, setSaving] = useState(false);
  const [importingXml, setImportingXml] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [deletingSku, setDeletingSku] = useState("");
  const [form, setForm] = useState({
    title: "",
    category: "Одежда / Футболки",
    price: "2500",
    condition: "Новое",
    description: "",
    characteristics: "Цвет черный",
  });

  const queueCount = useMemo(
    () => listings.filter((item) => ["ready", "draft", "error"].includes(item.status)).length,
    [listings],
  );

  const checkAgent = useCallback(async () => {
    try {
      const state = await agentFetch<{ running: boolean; version?: string; events?: RpaEvent[] }>("/api/rpa/status");
      setAgentStatus("online");
      setRpaRunning(Boolean(state.running));
      setAgentVersion(state.version ?? "");
      setEvents(state.events ?? []);
      const rows = await agentFetch<Listing[]>("/api/listings");
      setListings(rows);
    } catch {
      setAgentStatus("offline");
      setRpaRunning(false);
    }
  }, []);

  useEffect(() => {
    checkAgent();
    const timer = window.setInterval(checkAgent, 10_000);
    return () => window.clearInterval(timer);
  }, [checkAgent]);

  useEffect(() => {
    if (agentStatus !== "online") return;
    const source = new EventSource(`${AGENT_URL}/api/events`);
    source.onmessage = async (message) => {
      const event = JSON.parse(message.data) as RpaEvent;
      if (event.type === "clear") {
        setEvents([]);
        return;
      }
      setEvents((items) => [...items.slice(-180), event]);
      if (event.type === "run") {
        setRpaRunning(["starting", "running"].includes(String(event.status)));
      }
      if (event.type === "item" || event.type === "run") {
        agentFetch<Listing[]>("/api/listings").then(setListings).catch(() => undefined);
      }
    };
    source.onerror = () => {
      source.close();
      setAgentStatus("offline");
    };
    return () => source.close();
  }, [agentStatus]);

  async function handlePhotos(files: FileList | File[]) {
    const images = Array.from(files).filter((file) => file.type.startsWith("image/"));
    if (!images.length) return;
    const sku = makeSku(form.title || "wb-item");
    const payload = {
      sku,
      files: await Promise.all(images.map(fileToPayload)),
    };
    const result = await agentFetch<{ photos: UploadedPhoto[] }>("/api/uploads", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    setPhotos(result.photos);
  }

  async function saveAndPublish() {
    if (!form.title.trim()) throw new Error("Укажите название.");
    if (photos.length < 3) throw new Error("Загрузите минимум 3 фото.");
    if (!sizes.length) throw new Error("Выберите хотя бы один размер.");

    setSaving(true);
    try {
      await agentFetch("/api/listings", {
        method: "POST",
        body: JSON.stringify({
          sku: makeSku(form.title),
          title: form.title.trim(),
          category: form.category.trim(),
          photos: [...photos.map((photo) => photo.path), SIZE_GUIDE_URL].join(","),
          price: Number(form.price || 0),
          allow_offers: true,
          quantity: 1,
          condition: form.condition,
          description: form.description.trim(),
          characteristics: form.characteristics.trim(),
          pickup_point: DEFAULT_PICKUP_POINT,
          accept_rules: true,
          draft_only: false,
          status: "ready",
          note: "",
          sizes,
        }),
      });
      const startState = await agentFetch<{ running: boolean }>("/api/rpa/status");
      if (!startState.running) {
        await agentFetch("/api/rpa/start", { method: "POST" });
      }
      await checkAgent();
    } finally {
      setSaving(false);
    }
  }

  async function stopAgent() {
    await agentFetch("/api/rpa/stop", { method: "POST" });
    await checkAgent();
  }

  async function deleteListing(item: Listing) {
    if (!window.confirm(`Удалить объявление «${item.title}» из Wildberries и очереди?`)) return;
    setDeletingSku(item.sku);
    try {
      await agentFetch(`/api/listings/${encodeURIComponent(item.sku)}/delete-wb`, {
        method: "POST",
      });
      await checkAgent();
    } finally {
      setDeletingSku("");
    }
  }

  async function importXml(file: File) {
    setImportingXml(true);
    try {
      const xml = await file.text();
      const result = await agentFetch<{ imported: number; skippedDuplicates?: number; errors?: Array<{ index: number; title: string; error: string }>; publishing?: boolean }>("/api/import/xml", {
        method: "POST",
        body: JSON.stringify({ xml, publish: true, pickup_point: DEFAULT_PICKUP_POINT }),
      });
      setEvents((items) => [
        ...items,
        {
          time: new Date().toISOString(),
          message: `XML импортирован: ${result.imported} объявл. Пропущено дублей: ${result.skippedDuplicates ?? 0}. ${result.publishing ? "Публикация запущена." : ""}`,
        },
        ...(result.errors ?? []).map((error) => ({
          time: new Date().toISOString(),
          level: "error",
          message: `XML #${error.index}${error.title ? ` ${error.title}` : ""}: ${error.error}`,
        })),
      ]);
      await checkAgent();
    } finally {
      setImportingXml(false);
      if (xmlInputRef.current) xmlInputRef.current.value = "";
    }
  }

  return (
    <div className="app-shell">
      <div className="app-header">
        <div className="flex items-center gap-3">
          <div className="icon-tile h-9 w-9 bg-primary text-primary-foreground">
            <Store className="h-4 w-4" />
          </div>
          <div>
            <h1 className="text-lg font-semibold tracking-tight">WB Resale</h1>
            <p className="section-caption">Публикация идёт через локальный агент на ПК сотрудника</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <input
            ref={xmlInputRef}
            type="file"
            accept=".xml,text/xml,application/xml"
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) importXml(file).catch((error) => addError(error instanceof Error ? error.message : String(error)));
            }}
          />
          <Button variant="outline" size="sm" disabled={importingXml} onClick={() => xmlInputRef.current?.click()}>
            {importingXml ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileUp className="h-4 w-4" />}
            Импорт XML
          </Button>
          <Button variant="outline" size="sm" asChild>
            <a href="/downloads/install-wb-resale-agent.exe" download>
              Скачать агент
            </a>
          </Button>
        </div>
      </div>

      <div className="app-content space-y-4">
        <AgentBanner
          status={agentStatus}
          running={rpaRunning}
          version={agentVersion}
          updateAvailable={Boolean(agentVersion && agentVersion !== AGENT_VERSION)}
          onCheck={checkAgent}
        />

        {rpaRunning ? (
          <Card className="border-primary/25">
            <CardContent className="space-y-3 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold">Публикация выполняется</p>
                  <p className="text-sm text-muted-foreground">
                    {currentProgress(events, listings)}
                  </p>
                </div>
                <Button variant="destructive" size="sm" onClick={() => stopAgent().catch((error) => addError(String(error)))}>
                  <Octagon className="h-4 w-4" />
                  Остановить
                </Button>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-secondary">
                <div
                  className="h-full rounded-full bg-primary transition-[width] duration-200"
                  style={{ width: `${progressPercent(listings)}%` }}
                />
              </div>
            </CardContent>
          </Card>
        ) : null}

        {latestError(events) ? (
          <Card className="border-destructive/35 bg-destructive/5">
            <CardContent className="flex gap-3 p-4">
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />
              <div>
                <p className="text-sm font-semibold">Агенту нужна помощь</p>
                <p className="mt-1 text-sm text-muted-foreground">{latestError(events)}</p>
              </div>
            </CardContent>
          </Card>
        ) : null}

        <div className="grid gap-4 xl:grid-cols-[minmax(420px,0.85fr)_minmax(520px,1.15fr)]">
          <Card>
            <CardHeader>
              <CardTitle>Новая партия</CardTitle>
              <p className="text-sm text-muted-foreground">
                Заполните товар один раз. Будут созданы объявления по выбранным размерам и сразу отправлены в RPA.
              </p>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1">
                <Label>Название</Label>
                <Input value={form.title} onChange={(event) => setFormValue("title", event.target.value)} placeholder="Футболка Hysteric Glamour x Deftones 2009 черная" />
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label>Категория</Label>
                  <Input value={form.category} onChange={(event) => setFormValue("category", event.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label>Цена, ₽</Label>
                  <Input type="number" value={form.price} onChange={(event) => setFormValue("price", event.target.value)} />
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label>Состояние</Label>
                  <select
                    className="flex h-10 w-full rounded-md border border-input bg-card px-3 py-2 text-sm font-medium"
                    value={form.condition}
                    onChange={(event) => setFormValue("condition", event.target.value)}
                  >
                    <option>Новое</option>
                    <option>Идеальное</option>
                    <option>Хорошее</option>
                    <option>Есть дефекты</option>
                  </select>
                </div>
                <div className="space-y-1">
                  <Label>Пункт отправки</Label>
                  <Input value={DEFAULT_PICKUP_POINT} readOnly />
                </div>
              </div>

              <div
                className={`rounded-lg border border-dashed p-4 transition-colors ${dragging ? "border-primary bg-primary/5" : "border-input bg-secondary/40"}`}
                onDragOver={(event) => {
                  event.preventDefault();
                  setDragging(true);
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={(event) => {
                  event.preventDefault();
                  setDragging(false);
                  handlePhotos(event.dataTransfer.files).catch((error) => addError(String(error)));
                }}
              >
                <input ref={fileInputRef} type="file" accept="image/*" multiple hidden onChange={(event) => event.target.files && handlePhotos(event.target.files).catch((error) => addError(String(error)))} />
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-center gap-3">
                    <ImagePlus className="h-5 w-5 text-primary" />
                    <div>
                      <p className="text-sm font-semibold">Фото товара</p>
                      <p className="text-xs text-muted-foreground">Минимум 3 фото. Загружаются на локальный ПК агента.</p>
                    </div>
                  </div>
                  <Button type="button" variant="outline" onClick={() => fileInputRef.current?.click()}>
                    <UploadCloud className="h-4 w-4" />
                    Выбрать
                  </Button>
                </div>
              </div>

              {photos.length ? (
                <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
                  {photos.map((photo, index) => (
                    <div key={photo.path} className="relative aspect-square overflow-hidden rounded-md bg-secondary">
                      <img src={`${AGENT_URL}${photo.preview}`} alt="" className="h-full w-full object-cover" />
                      <span className="absolute left-1.5 top-1.5 grid h-5 w-5 place-items-center rounded-full bg-black/75 text-[11px] font-bold text-white">
                        {index + 1}
                      </span>
                    </div>
                  ))}
                </div>
              ) : null}

              <div className="space-y-2">
                <Label>Размеры</Label>
                <div className="grid grid-cols-4 gap-2 sm:grid-cols-7">
                  {SIZES.map((size) => (
                    <label key={size} className="flex h-10 items-center justify-center gap-1 rounded-md border border-input bg-card text-sm font-semibold">
                      <input
                        type="checkbox"
                        checked={sizes.includes(size)}
                        onChange={() => setSizes((current) => current.includes(size) ? current.filter((item) => item !== size) : [...current, size])}
                      />
                      {size}
                    </label>
                  ))}
                </div>
              </div>

              <div className="space-y-1">
                <Label>Описание</Label>
                <Textarea rows={5} value={form.description} onChange={(event) => setFormValue("description", event.target.value)} placeholder="Описание товара для WB" />
              </div>

              <div className="space-y-1">
                <Label>Характеристики без размера</Label>
                <Input value={form.characteristics} onChange={(event) => setFormValue("characteristics", event.target.value)} placeholder="Цвет черный, плотность 180 г/м²" />
              </div>

              <Button className="w-full" disabled={saving} onClick={() => saveAndPublish().catch((error) => addError(error instanceof Error ? error.message : String(error)))}>
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                Сохранить и опубликовать
              </Button>
            </CardContent>
          </Card>

          <div className="space-y-4">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between gap-3">
                  <CardTitle>Очередь локального агента</CardTitle>
                  <Badge variant="secondary">{queueCount} к публикации</Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-2">
                {listings.length ? listings.slice(0, 30).map((item) => (
                  <div key={item.sku} className="flex gap-3 rounded-md border border-border/80 p-3">
                    <img
                      src={listingCover(item.photos)}
                      alt=""
                      className="h-16 w-16 shrink-0 rounded-md bg-secondary object-cover"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold">{item.title}</p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {Number(item.price || 0).toLocaleString("ru-RU")} ₽ · {extractSize(item.characteristics) || "размер не указан"}
                          </p>
                        </div>
                        <Badge className="shrink-0" variant={item.status === "error" ? "destructive" : "secondary"}>
                          {statusLabels[item.status] ?? item.status}
                        </Badge>
                      </div>
                      {item.note ? <p className="mt-1 line-clamp-2 text-xs text-destructive">{item.note}</p> : null}
                      <div className="mt-2 flex flex-wrap gap-2">
                        {item.listing_url ? (
                          <Button asChild variant="outline" size="sm" className="h-8">
                            <a href={item.listing_url} target="_blank" rel="noreferrer">
                              <ExternalLink className="h-3.5 w-3.5" />
                              Открыть
                            </a>
                          </Button>
                        ) : null}
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-8 text-destructive hover:text-destructive"
                          disabled={Boolean(deletingSku) || rpaRunning}
                          onClick={() => deleteListing(item).catch((error) => addError(error instanceof Error ? error.message : String(error)))}
                        >
                          {deletingSku === item.sku ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                          Удалить
                        </Button>
                      </div>
                    </div>
                  </div>
                )) : (
                  <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
                    Очередь пуста или агент не запущен.
                  </p>
                )}
              </CardContent>
            </Card>

          </div>
        </div>
      </div>
    </div>
  );

  function setFormValue(key: keyof typeof form, value: string) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function addError(message: string) {
    setEvents((items) => [...items, { time: new Date().toISOString(), level: "error", message }]);
  }
}

function AgentBanner({
  status,
  running,
  version,
  updateAvailable,
  onCheck,
}: {
  status: AgentStatus;
  running: boolean;
  version: string;
  updateAvailable: boolean;
  onCheck: () => Promise<void>;
}) {
  if (status === "online") {
    return (
      <Card className="border-emerald-500/25 bg-emerald-500/8">
        <CardContent className="flex items-start gap-3 p-4">
          <CheckCircle2 className="mt-0.5 h-5 w-5 text-emerald-600" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold">Локальный WB-агент подключён{running ? ", публикация идёт" : ""}</p>
            <p className="text-sm text-muted-foreground">
              Версия {version || "не определена"}. Публикация выполняется на этом компьютере.
            </p>
            {updateAvailable ? (
              <Button asChild size="sm" className="mt-3">
                <a href="/downloads/install-wb-resale-agent.exe" download>
                  <RefreshCw className="h-4 w-4" />
                  Обновить агент
                </a>
              </Button>
            ) : null}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-amber-500/30 bg-amber-500/8">
      <CardContent className="flex items-start gap-3 p-4">
        <AlertTriangle className="mt-0.5 h-5 w-5 text-amber-600" />
        <div className="space-y-1">
          <p className="text-sm font-semibold">Локальный WB-агент не найден</p>
          <p className="text-sm text-muted-foreground">
            Запустите на этом ПК файл <span className="font-semibold text-foreground">WB Resale CRM / Запустить CRM.bat</span>, затем обновите страницу.
            Без локального агента браузер WB нельзя открыть от имени сотрудника.
          </p>
          <div className="flex flex-wrap gap-2 pt-2">
            <Button type="button" variant="outline" size="sm" onClick={() => onCheck()}>
              <RefreshCw className="h-4 w-4" />
              Проверить снова
            </Button>
            <Button asChild size="sm">
              <a href="/downloads/install-wb-resale-agent.exe" download>
                Скачать установщик агента
              </a>
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

async function agentFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${AGENT_URL}${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
  const data = await response.json();
  if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : "Ошибка локального агента");
  return data as T;
}

function fileToPayload(file: File) {
  return new Promise<{ name: string; type: string; data: string | ArrayBuffer | null }>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve({ name: file.name, type: file.type, data: reader.result });
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function makeSku(value: string) {
  const slug = value
    .trim()
    .toLowerCase()
    .replaceAll("+", "plus")
    .replace(/[^a-z0-9а-яё]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 42);
  return `${slug || "wb-item"}-${Date.now().toString(36)}`;
}

function extractSize(value: string) {
  return String(value || "").match(/размер\s+([^,;\n]+)/i)?.[1]?.trim() || "";
}

function listingCover(value: string) {
  const first = String(value || "").split(",").map((item) => item.trim()).find(Boolean);
  if (!first) return "/assets/ky-strok-size-guide-v2.jpg";
  if (/^https?:\/\//i.test(first)) return first;
  return `${AGENT_URL}/api/photos/${first.split("/").map(encodeURIComponent).join("/")}`;
}

function progressPercent(listings: Listing[]) {
  const total = listings.length || 1;
  const completed = listings.filter((item) => ["moderation", "posted", "error"].includes(item.status)).length;
  return Math.max(4, Math.min(100, Math.round((completed / total) * 100)));
}

function currentProgress(events: RpaEvent[], listings: Listing[]) {
  const latest = [...events].reverse().find((event) => event.type === "item" || event.type === "run");
  if (latest?.message) return latest.id ? `${latest.id}: ${latest.message}` : latest.message;
  const active = listings.find((item) => item.status === "running");
  return active ? `Обрабатывается: ${active.title}` : "Подготавливаю очередь";
}

function latestError(events: RpaEvent[]) {
  return [...events].reverse().find((event) =>
    event.level === "error" || event.status === "error" || event.status === "failed"
  )?.message;
}
