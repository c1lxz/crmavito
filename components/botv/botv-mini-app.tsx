"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Download,
  FileArchive,
  History,
  ImageIcon,
  Link2,
  Loader2,
  MapPin,
  MoreHorizontal,
  Package,
  PackageCheck,
  PanelTop,
  Plus,
  Search,
  Send,
  SlidersHorizontal,
  Trash2,
  UploadCloud,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { AvitoProfileSelect, type AvitoServiceProfile } from "@/components/avito/avito-profile-select";
import type { BotvLocation, BotvProduct, BotvSession, BotvSessionHistoryItem } from "@/lib/botv/session";

type Status = "idle" | "uploading" | "ready" | "saving" | "generating";
type UploadProgress = {
  fileName: string;
  loaded: number;
  total: number;
  percent: number;
  phase: "uploading" | "processing";
};

type PublishResult = {
  feedUrl?: string;
  profileStatus?: number;
  profileWarning?: string;
  uploadStatus?: number;
  adIds?: string[];
  legacyIds?: boolean;
  master?: {
    previousAds: number;
    addedAds: number;
    updatedAds: number;
    removedAds: number;
    totalAds: number;
  };
};

type AutoloadUpload = {
  upload_id?: number | string;
  status?: string;
  started_at?: string;
  feed_urls?: { name?: string; url?: string }[];
  stats?: { count?: number; title?: string; sections?: AutoloadStatSection[] };
};

type AutoloadStatSection = {
  title?: string;
  count?: number;
  sections?: AutoloadStatSection[];
};

type AutoloadStatus = {
  current?: AutoloadUpload | null;
  lastSuccessful?: AutoloadUpload | null;
  uploads?: AutoloadUpload[];
};

type XmlStockStatus = {
  quantity: string | null;
  count: number;
  message: string;
};

function formatRub(value: number | null) {
  if (value == null) return "Цена не задана";
  return new Intl.NumberFormat("ru-RU").format(value) + " ₽";
}

const BOTV_API_BASE = "/v-data/botv/work";
const UPLOAD_CHUNK_BYTES = 256 * 1024;
const UPLOAD_CHUNK_DELAY_MS = 500;
const UPLOAD_CHUNK_RETRIES = 5;

function photoUrl(sessionId: string, token: string | null, options?: { thumb?: boolean; size?: number }) {
  if (!token) return "";
  const params = new URLSearchParams({ token });
  if (options?.thumb) params.set("thumb", "1");
  if (options?.size) params.set("size", String(options.size));
  return `${BOTV_API_BASE}/${sessionId}/photo?${params.toString()}`;
}

type ProductColor = NonNullable<BotvProduct["color"]>;

const PRODUCT_COLORS: ProductColor[] = ["Чёрный", "Белый"];

function formatDate(value: number | null | undefined) {
  if (!value) return "";
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value * 1000));
}

function wait(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function formatBytes(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "0 MB";
  const units = ["B", "KB", "MB", "GB"];
  let size = value;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${size.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}

function formatUploadDate(value?: string) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function uploadLine(upload: AutoloadUpload | null | undefined) {
  if (!upload) return "Нет данных";
  const parts = [
    upload.upload_id ? `#${upload.upload_id}` : null,
    upload.status ? `статус: ${upload.status}` : null,
    upload.started_at ? `старт: ${formatUploadDate(upload.started_at)}` : null,
    typeof upload.stats?.count === "number" ? `${upload.stats.count} объявлений` : null,
  ].filter(Boolean);
  return parts.join(" · ") || "Есть загрузка";
}

function uploadStatLines(upload: AutoloadUpload | null | undefined) {
  const sections = upload?.stats?.sections ?? [];
  return sections.flatMap((section) => {
    const line = section.title && typeof section.count === "number" ? `${section.title}: ${section.count}` : null;
    const nested = (section.sections ?? [])
      .map((item) => item.title && typeof item.count === "number" ? `${item.title}: ${item.count}` : null)
      .filter(Boolean) as string[];
    return line ? [line, ...nested] : nested;
  });
}

function AdIdsBlock({ title, adIds }: { title: string; adIds: string[] }) {
  if (adIds.length === 0) return null;
  const visible = adIds.slice(0, 80);
  return (
    <div className="rounded-md border border-border/80 bg-card/70 p-3 text-sm">
      <p className="font-semibold">{title}: {adIds.length}</p>
      <div className="mt-2 flex max-h-32 flex-wrap gap-1 overflow-y-auto">
        {visible.map((id) => (
          <span key={id} className="rounded bg-secondary px-2 py-1 font-mono text-[11px] text-secondary-foreground">
            {id}
          </span>
        ))}
        {adIds.length > visible.length && (
          <span className="rounded bg-secondary px-2 py-1 text-[11px] text-muted-foreground">
            ещё {adIds.length - visible.length}
          </span>
        )}
      </div>
    </div>
  );
}

function parseAdIdsXml(xml: string): string[] {
  return Array.from(xml.matchAll(/<Id>([^<]+)<\/Id>/g), (match) => match[1]?.trim()).filter(Boolean) as string[];
}

function parseXmlStockStatus(xml: string): XmlStockStatus {
  const quantities = Array.from(
    xml.matchAll(/<Quantity>([^<]*)<\/Quantity>/g),
    (match) => match[1]?.trim() ?? "",
  ).filter(Boolean);
  const unique = Array.from(new Set(quantities));

  if (quantities.length === 0) {
    return {
      quantity: null,
      count: 0,
      message: "Последний XML: остаток не задан, тег Quantity не добавлен.",
    };
  }

  if (unique.length === 1) {
    return {
      quantity: unique[0],
      count: quantities.length,
      message: `Последний XML: Quantity ${unique[0]} добавлен в ${quantities.length} объявл.`,
    };
  }

  return {
    quantity: null,
    count: quantities.length,
    message: `Последний XML: найдено ${quantities.length} Quantity с разными значениями: ${unique.join(", ")}.`,
  };
}

async function apiFetch(input: RequestInfo | URL, init?: RequestInit, retries = 3) {
  for (let attempt = 0; attempt < retries; attempt += 1) {
    try {
      return await fetch(input, init);
    } catch {
      if (attempt < retries - 1) {
        await wait(500 * (attempt + 1));
      }
    }
  }
  throw new Error("Сервер временно не ответил. Попробуй ещё раз.");
}

async function readJsonResponse(res: Response, fallback: string) {
  const text = await res.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    if (!res.ok) throw new Error(fallback);
    return {};
  }
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
                src={photoUrl(sessionId, token, { thumb: true, size: 960 })}
                className="h-72 w-full min-w-full snap-center rounded-md object-cover sm:h-96"
                alt=""
                loading="lazy"
                decoding="async"
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
          <div><span className="text-muted-foreground">Цвет: </span>{product.color || product.details.color || "Не указан"}</div>
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
  const customXmlRef = useRef<HTMLInputElement>(null);
  const [session, setSession] = useState<BotvSession | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<number>>(() => new Set());
  const [bulkPrice, setBulkPrice] = useState("");
  const [dropStockInput, setDropStockInput] = useState("");
  const [newLocationCity, setNewLocationCity] = useState("");
  const [newLocationAddress, setNewLocationAddress] = useState("");
  const [diskLink, setDiskLink] = useState("");
  const [preview, setPreview] = useState<BotvProduct | null>(null);
  const [phonePromptOpen, setPhonePromptOpen] = useState(false);
  const [replacementPhone, setReplacementPhone] = useState("");
  const [replacementXmlCount, setReplacementXmlCount] = useState(0);
  const [history, setHistory] = useState<BotvSessionHistoryItem[]>([]);
  const [historyOpen, setHistoryOpen] = useState(true);
  const [publishProfiles, setPublishProfiles] = useState<AvitoServiceProfile[]>([]);
  const [selectedPublishProfileId, setSelectedPublishProfileId] = useState("");
  const [manualPublishClientId, setManualPublishClientId] = useState("");
  const [manualPublishClientSecret, setManualPublishClientSecret] = useState("");
  const [manualPublishReportEmail, setManualPublishReportEmail] = useState("");
  const [publishing, setPublishing] = useState(false);
  const [publishingCustomXml, setPublishingCustomXml] = useState(false);
  const [customXmlFile, setCustomXmlFile] = useState<File | null>(null);
  const [customXmlAdIds, setCustomXmlAdIds] = useState<string[]>([]);
  const [stoppingAutoload, setStoppingAutoload] = useState(false);
  const [publishLegacyIds, setPublishLegacyIds] = useState(false);
  const [publishResult, setPublishResult] = useState<PublishResult | null>(null);
  const [autoloadStopMessage, setAutoloadStopMessage] = useState("");
  const [lastXmlAdIds, setLastXmlAdIds] = useState<string[]>([]);
  const [dropStockStatus, setDropStockStatus] = useState("");
  const [lastXmlStockStatus, setLastXmlStockStatus] = useState<XmlStockStatus | null>(null);
  const [publishStatusLoading, setPublishStatusLoading] = useState(false);
  const [autoloadStatus, setAutoloadStatus] = useState<AutoloadStatus | null>(null);
  const [uploadProgress, setUploadProgress] = useState<UploadProgress | null>(null);
  const manualColorOverrides = useRef(new Map<string, ProductColor>());

  const products = session?.products ?? [];
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return products.filter(
      (p) => !q || p.name.toLowerCase().includes(q) || p.adTitle.toLowerCase().includes(q),
    );
  }, [products, query]);
  const selectedIds = Array.from(selected);
  const allVisibleSelected = filtered.length > 0 && filtered.every((p) => selected.has(p.index));
  const manualPublishCredentialsComplete = Boolean(manualPublishClientId.trim() && manualPublishClientSecret.trim());
  const manualPublishCredentialsPartial = Boolean(manualPublishClientId.trim() || manualPublishClientSecret.trim()) && !manualPublishCredentialsComplete;
  const selectedPublishProfile = publishProfiles.find((profile) => profile.id === selectedPublishProfileId) ?? null;
  const hasPublishAuth = manualPublishCredentialsComplete || Boolean(selectedPublishProfile?.hasCredentials);
  useEffect(() => {
    runInitialLoad();
  }, []);

  async function runInitialLoad() {
    await refreshHistory();
    await refreshPublishProfiles();
    const savedId = window.localStorage.getItem("botv:lastSessionId");
    if (!savedId) return;
    try {
      await openSession(savedId);
    } catch {
      window.localStorage.removeItem("botv:lastSessionId");
      setStatus("idle");
    }
  }

  async function refreshHistory() {
    const res = await apiFetch(`${BOTV_API_BASE}?limit=12`);
    if (!res.ok) return;
    const data = await readJsonResponse(res, "Не удалось загрузить историю");
    setHistory(Array.isArray(data.sessions) ? data.sessions : []);
  }

  function rememberSession(data: BotvSession) {
    setSession(applyManualColorOverrides(data));
    setDropStockInput(data.dropStockQuantity == null ? "" : String(data.dropStockQuantity));
    setDropStockStatus(
      data.dropStockQuantity == null
        ? "Остаток XML не задан: Avito сам будет считать остаток по фиду."
        : `Остаток XML сохранён: ${data.dropStockQuantity}. Он попадёт во все объявления нового XML.`,
    );
    window.localStorage.setItem("botv:lastSessionId", data.id);
    setPublishResult(null);
    setLastXmlAdIds([]);
    setLastXmlStockStatus(null);
    setAutoloadStatus(null);
  }

  function applyManualColorOverrides(data: BotvSession): BotvSession {
    return {
      ...data,
      products: data.products.map((product) => {
        const color = manualColorOverrides.current.get(`${data.id}:${product.index}`);
        return color ? { ...product, color, details: { ...product.details, color } } : product;
      }),
    };
  }

  function updateLocalProduct(index: number, update: Partial<BotvProduct>) {
    setSession((current) => current && ({
      ...current,
      products: current.products.map((product) => (
        product.index === index ? { ...product, ...update } : product
      )),
    }));
    setPreview((current) => current?.index === index ? { ...current, ...update } : current);
  }

  async function openSession(id: string) {
    setStatus("uploading");
    setError("");
    const res = await apiFetch(`${BOTV_API_BASE}/${id}`);
    const data = await readJsonResponse(res, "Не удалось открыть сохранение");
    if (!res.ok) throw new Error(data.error ?? "Не удалось открыть сохранение");
    rememberSession(data);
    setSelected(new Set());
    setPreview(null);
    setStatus("ready");
  }

  async function uploadLink() {
    if (!diskLink.trim()) return;
    setStatus("uploading");
    setError("");
    setSelected(new Set());
    const form = new FormData();
    form.append("link", diskLink.trim());
    const res = await apiFetch(BOTV_API_BASE, { method: "POST", body: form });
    const data = await readJsonResponse(res, "Не удалось загрузить ссылку");
    if (!res.ok) throw new Error(data.error ?? "Не удалось загрузить ссылку");
    rememberSession(data);
    await refreshHistory();
    setStatus("ready");
  }

  async function upload(file: File) {
    setStatus("uploading");
    setError("");
    setSelected(new Set());
    setUploadProgress({ fileName: file.name, loaded: 0, total: file.size, percent: 0, phase: "uploading" });
    const res = await uploadArchiveWithProgress(file);
    const data = parseJsonText(res.text, "Не удалось загрузить архив", res.ok);
    if (!res.ok) throw new Error(data.error ?? "Не удалось загрузить архив");
    rememberSession(data);
    await refreshHistory();
    setUploadProgress(null);
    setStatus("ready");
  }

  async function uploadArchiveWithProgress(file: File) {
    const uploadId = typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const totalChunks = Math.max(1, Math.ceil(file.size / UPLOAD_CHUNK_BYTES));

    for (let index = 0; index < totalChunks; index += 1) {
      const start = index * UPLOAD_CHUNK_BYTES;
      const end = Math.min(file.size, start + UPLOAD_CHUNK_BYTES);
      await sendUploadChunk(uploadId, file.name, index, totalChunks, file.slice(start, end));
      const loaded = end;
      const percent = file.size > 0 ? Math.min(99, Math.round((loaded / file.size) * 100)) : 0;
      setUploadProgress({ fileName: file.name, loaded, total: file.size, percent, phase: "uploading" });
      if (index < totalChunks - 1) await wait(UPLOAD_CHUNK_DELAY_MS);
    }

    setUploadProgress({ fileName: file.name, loaded: file.size, total: file.size, percent: 100, phase: "processing" });
    const res = await finalizeChunkUpload(uploadId, file.name, totalChunks);
    return { ok: res.ok, status: res.status, text: await res.text() };
  }

  async function sendUploadChunk(uploadId: string, fileName: string, index: number, totalChunks: number, chunk: Blob) {
    for (let attempt = 0; attempt < UPLOAD_CHUNK_RETRIES; attempt += 1) {
      try {
        const form = new FormData();
        form.append("action", "chunk");
        form.append("uploadId", uploadId);
        form.append("fileName", fileName);
        form.append("index", String(index));
        form.append("totalChunks", String(totalChunks));
        form.append("chunk", chunk, `${index}.part`);
        const res = await fetch(`${BOTV_API_BASE}/chunk`, { method: "POST", body: form });
        if (res.ok) return;
        if (attempt === UPLOAD_CHUNK_RETRIES - 1) {
          const data = await readJsonResponse(res, "Не удалось загрузить часть архива");
          throw new Error(data.error ?? "Не удалось загрузить часть архива");
        }
      } catch (error) {
        if (attempt === UPLOAD_CHUNK_RETRIES - 1) throw error;
      }
      await wait(800 * (attempt + 1));
    }
  }

  function finalizeChunkUpload(uploadId: string, fileName: string, totalChunks: number) {
    const form = new FormData();
    form.append("action", "finalize");
    form.append("uploadId", uploadId);
    form.append("fileName", fileName);
    form.append("totalChunks", String(totalChunks));
    return apiFetch(`${BOTV_API_BASE}/chunk`, { method: "POST", body: form }, 5);
  }

  function parseJsonText(text: string, fallback: string, ok: boolean) {
    if (!text) return {};
    try {
      return JSON.parse(text);
    } catch {
      if (!ok) throw new Error(fallback);
      return {};
    }
  }

  async function patch(payload: unknown) {
    if (!session) return;
    setStatus("saving");
    const res = await apiFetch(`${BOTV_API_BASE}/${session.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await readJsonResponse(res, "Не удалось сохранить");
    if (!res.ok) throw new Error(data.error ?? "Не удалось сохранить");
    rememberSession(data);
    void refreshHistory();
    setStatus("ready");
    return data;
  }

  async function saveLocations(locations: BotvLocation[]) {
    await patch({ locations });
  }

  async function toggleLocation(locationIndex: number) {
    if (!session) return;
    const locations = session.locations.map((location, index) => (
      index === locationIndex ? { ...location, enabled: !location.enabled } : location
    ));
    if (!locations.some((location) => location.enabled)) {
      throw new Error("Для XML должен быть выбран хотя бы один город.");
    }
    await saveLocations(locations);
  }

  async function addLocation() {
    if (!session) return;
    const city = newLocationCity.trim();
    const address = newLocationAddress.trim();
    if (!city || !address) throw new Error("Укажите город и полный адрес с улицей и домом.");
    if (city.toLocaleLowerCase("ru-RU") === address.toLocaleLowerCase("ru-RU")) {
      throw new Error("Для нового города нужен полный адрес с улицей и домом.");
    }
    await saveLocations([...session.locations, { city, address, enabled: true, custom: true }]);
    setNewLocationCity("");
    setNewLocationAddress("");
  }

  async function removeLocation(locationIndex: number) {
    if (!session) return;
    const locations = session.locations.filter((_, index) => index !== locationIndex);
    if (!locations.some((location) => location.enabled)) {
      throw new Error("Нельзя удалить последний выбранный город для XML.");
    }
    await saveLocations(locations);
  }

  async function downloadXml(phone?: string) {
    if (!session) return;
    setStatus("generating");
    setError("");
    const params = new URLSearchParams();
    if (!publishLegacyIds) params.set("profileId", manualPublishCredentialsComplete ? manualPublishClientId.trim() : selectedPublishProfileId);
    const query = params.toString();
    const res = await apiFetch(`${BOTV_API_BASE}/${session.id}/xml${query ? `?${query}` : ""}`, {
      method: "POST",
      headers: phone ? { "content-type": "application/json" } : undefined,
      body: phone ? JSON.stringify({ phone }) : undefined,
    });
    if (!res.ok) {
      const data = await readJsonResponse(res, "Не удалось собрать XML");
      throw new Error(data.error ?? "Не удалось собрать XML");
    }
    const blob = await res.blob();
    const xmlText = await blob.text();
    setLastXmlAdIds(parseAdIdsXml(xmlText));
    setLastXmlStockStatus(parseXmlStockStatus(xmlText));
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = res.headers.get("content-disposition")?.match(/filename="(.+)"/)?.[1] ?? "avito.xml";
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
    setStatus("ready");
  }

  async function generateXml() {
    await downloadXml();
    setReplacementXmlCount(0);
    setPhonePromptOpen(true);
  }

  async function downloadReplacementXml() {
    await downloadXml(replacementPhone);
    setReplacementPhone("");
    setReplacementXmlCount((count) => count + 1);
  }

  async function run(action: () => Promise<unknown>) {
    try {
      await action();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setUploadProgress(null);
      setStatus(session ? "ready" : "idle");
    }
  }

  async function refreshPublishProfiles(preferredId?: string) {
    const response = await apiFetch("/api/avito-profiles/credentials");
    if (!response.ok) return;
    const data = await readJsonResponse(response, "Не удалось загрузить профили Avito");
    const profiles: AvitoServiceProfile[] = Array.isArray(data.profiles) ? data.profiles : [];
    setPublishProfiles(profiles);

    const selected =
      profiles.find((profile) => profile.id === (preferredId || selectedPublishProfileId)) ??
      profiles.find((profile) => profile.hasCredentials) ?? profiles[0];
    if (selected) applyPublishProfile(selected);
  }

  function applyPublishProfile(profile: AvitoServiceProfile) {
    setSelectedPublishProfileId(profile.id);
  }

  function publishAuthPayload() {
    return manualPublishCredentialsComplete
      ? {
          clientId: manualPublishClientId.trim(),
          clientSecret: manualPublishClientSecret.trim(),
          reportEmail: manualPublishReportEmail.trim() || null,
        }
      : { profileId: selectedPublishProfileId };
  }

  async function publishXml() {
    if (!session) return;
    setPublishing(true);
    setError("");
    try {
      const res = await apiFetch(`/api/botv/session/${session.id}/publish`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...publishAuthPayload(),
          legacyIds: publishLegacyIds,
        }),
      });
      const data = await readJsonResponse(res, "Не удалось опубликовать XML");
      if (!res.ok) throw new Error(data.error ?? "Не удалось опубликовать XML");
      const adIds: string[] = Array.isArray(data.adIds) ? data.adIds.map(String).filter(Boolean) : [];
      setPublishResult({ ...(data.publish ?? {}), adIds, legacyIds: Boolean(data.legacyIds), master: data.master });
      setAutoloadStopMessage("");
      setError("");
    } finally {
      setPublishing(false);
    }
  }

  async function selectCustomXml(file: File) {
    const xml = await file.text();
    const adIds = parseAdIdsXml(xml);
    if (!/^\s*(?:<\?xml\b[^>]*>\s*)?<Ads\b/i.test(xml) || adIds.length === 0) {
      throw new Error("Выберите непустой XML-файл Avito.");
    }
    if (new Set(adIds).size !== adIds.length) {
      throw new Error("В готовом XML есть повторяющиеся ID.");
    }
    setCustomXmlFile(file);
    setCustomXmlAdIds(adIds);
    setPublishResult(null);
  }

  async function publishCustomXml() {
    if (!customXmlFile) throw new Error("Сначала выберите готовый XML.");
    if (!hasPublishAuth || manualPublishCredentialsPartial) {
      throw new Error("Выберите профиль Avito или полностью укажите client_id и client_secret.");
    }
    setPublishingCustomXml(true);
    setError("");
    try {
      const form = new FormData();
      form.append("file", customXmlFile);
      const authPayload = publishAuthPayload();
      for (const [key, value] of Object.entries(authPayload)) {
        if (value) form.append(key, String(value));
      }
      const res = await apiFetch("/api/botv/custom-xml/publish", { method: "POST", body: form }, 1);
      const data = await readJsonResponse(res, "Не удалось опубликовать готовый XML");
      if (!res.ok) throw new Error(data.error ?? "Не удалось опубликовать готовый XML");
      const adIds: string[] = Array.isArray(data.adIds) ? data.adIds.map(String).filter(Boolean) : [];
      setPublishResult({ ...(data.publish ?? {}), adIds, master: data.master });
      setLastXmlAdIds(adIds);
      setAutoloadStopMessage("");
      setCustomXmlFile(null);
      setCustomXmlAdIds([]);
      if (customXmlRef.current) customXmlRef.current.value = "";
    } finally {
      setPublishingCustomXml(false);
    }
  }

  async function stopAutoload() {
    setStoppingAutoload(true);
    setError("");
    setAutoloadStopMessage("");
    try {
      const res = await apiFetch("/api/avito/autoload/stop", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(publishAuthPayload()),
      });
      const data = await readJsonResponse(res, "Не удалось остановить автозагрузку");
      if (!res.ok) throw new Error(data.error ?? "Не удалось остановить автозагрузку");
      setAutoloadStopMessage(data.message ?? "Автозагрузка отключена.");
      await checkAutoloadStatus();
    } finally {
      setStoppingAutoload(false);
    }
  }

  async function checkAutoloadStatus() {
    setPublishStatusLoading(true);
    setError("");
    try {
      const res = await apiFetch("/api/avito/autoload/status", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(publishAuthPayload()),
      });
      const data = await readJsonResponse(res, "Не удалось получить статус автозагрузки");
      if (!res.ok) throw new Error(data.error ?? "Не удалось получить статус автозагрузки");
      setAutoloadStatus(data.status ?? null);
    } finally {
      setPublishStatusLoading(false);
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
    const nextPhotos = reorderTokens(product.photos, token, direction);
    updateLocalProduct(product.index, { photos: nextPhotos, firstPhoto: nextPhotos[0] ?? null });
    await patch({ products: [{ index: product.index, movePhoto: { token, direction } }] });
  }

  async function toggleOriginalTitle(product: BotvProduct) {
    const useOriginalTitle = !product.useOriginalTitle;
    updateLocalProduct(product.index, {
      useOriginalTitle,
      adTitle: useOriginalTitle ? product.name : product.adTitle,
    });
    await patch({ products: [{ index: product.index, useOriginalTitle }] });
  }

  async function toggleDeleted(product: BotvProduct) {
    updateLocalProduct(product.index, { deleted: !product.deleted });
    await patch({ products: [{ index: product.index, deleted: !product.deleted }] });
  }

  async function saveProductTitle(index: number, value: string) {
    updateLocalProduct(index, { adTitle: value });
    await patch({ products: [{ index, adTitle: value }] });
  }

  async function saveProductPrice(index: number, value: number | null) {
    updateLocalProduct(index, { price: value });
    const saved = await patch({ products: [{ index, price: value }] });
    const savedPrice = saved?.products.find((product: BotvProduct) => product.index === index)?.price ?? null;
    if (savedPrice !== value) {
      throw new Error("Цена не сохранилась. Повторите ввод.");
    }
  }

  async function saveProductDescription(index: number, value: string) {
    updateLocalProduct(index, { description: value });
    await patch({ products: [{ index, description: value }] });
  }

  async function saveProductColor(product: BotvProduct, color: ProductColor) {
    if (session) manualColorOverrides.current.set(`${session.id}:${product.index}`, color);
    updateLocalProduct(product.index, {
      color,
      details: { ...product.details, color },
    });
    await patch({ products: [{ index: product.index, color }] });
  }

  async function saveDropStockQuantity() {
    const trimmed = dropStockInput.trim();
    if (!trimmed) {
      await patch({ dropStockQuantity: null });
      setDropStockStatus("Остаток XML очищен: в следующем XML тег Quantity добавлен не будет.");
      setLastXmlStockStatus(null);
      return;
    }
    const quantity = Number(trimmed);
    if (!Number.isInteger(quantity) || quantity < 0) {
      throw new Error("Остаток дропа должен быть целым числом от 0");
    }
    await patch({ dropStockQuantity: quantity });
    setDropStockStatus(`Остаток XML сохранён: ${quantity}. Скачай или опубликуй XML, чтобы применить его в Avito.`);
    setLastXmlStockStatus(null);
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
            <details className="group relative">
              <summary className="flex h-9 cursor-pointer list-none items-center gap-2 rounded-md border border-input bg-background px-3 text-sm font-medium shadow-sm transition-colors hover:bg-accent hover:text-accent-foreground">
                <MoreHorizontal className="h-4 w-4" />
                Ещё
              </summary>
              <div className="absolute right-0 top-full z-40 mt-2 w-52 rounded-md border border-border bg-popover p-1.5 text-popover-foreground shadow-lg">
                <button
                  type="button"
                  className="flex h-9 w-full items-center gap-2 rounded px-2.5 text-left text-sm hover:bg-accent"
                  onClick={() => setHistoryOpen((value) => !value)}
                >
                  <History className="h-4 w-4" />
                  История
                </button>
                <Link
                  href="/settings/stocks"
                  className="flex h-9 w-full items-center gap-2 rounded px-2.5 text-sm hover:bg-accent"
                >
                  <PackageCheck className="h-4 w-4" />
                  Остатки Avito
                </Link>
              </div>
            </details>
            <input ref={fileRef} type="file" accept=".zip,.rar,.7z" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; e.currentTarget.value = ""; if (f) run(() => upload(f)); }} />
          </div>
          <div className="grid gap-2 lg:grid-cols-[minmax(240px,360px)_minmax(260px,420px)] lg:justify-end">
            <details className="group rounded-md border border-input bg-background">
              <summary className="flex h-10 cursor-pointer list-none items-center gap-2 px-3 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground">
                <Link2 className="h-4 w-4" />
                Загрузить по ссылке
                <span className="ml-auto text-xs opacity-70">Яндекс.Диск</span>
              </summary>
              <div className="flex gap-2 border-t border-border/80 p-2">
                <Input aria-label="Ссылка на Яндекс.Диск" placeholder="Ссылка на Яндекс.Диск" value={diskLink} onChange={(e) => setDiskLink(e.target.value)} />
                <Button variant="outline" onClick={() => run(uploadLink)} disabled={status === "uploading" || !diskLink.trim()}>Загрузить</Button>
              </div>
            </details>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input placeholder="Поиск по товарам" className="pl-9" value={query} onChange={(e) => setQuery(e.target.value)} />
            </div>
          </div>
          {uploadProgress && (
            <div className="mt-3 rounded-md border border-border/80 bg-card/70 p-3">
              <div className="mb-2 flex items-center justify-between gap-3 text-xs">
                <div className="min-w-0">
                  <p className="truncate font-semibold text-foreground">{uploadProgress.fileName}</p>
                  <p className="text-muted-foreground">
                    {uploadProgress.phase === "uploading" ? "Загружается" : "Файл загружен, сервер распаковывает"} · {formatBytes(uploadProgress.loaded)} / {formatBytes(uploadProgress.total)}
                  </p>
                </div>
                <span className="shrink-0 font-semibold text-foreground">{uploadProgress.percent}%</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-primary transition-[width] duration-200"
                  style={{ width: `${uploadProgress.percent}%` }}
                />
              </div>
            </div>
          )}
        </div>
      </div>

      {session && (
        <div className="border-b border-border/80 bg-card/45 px-4 py-3 text-sm lg:px-8">
          <div className="mx-auto flex max-w-[1600px] gap-5 overflow-x-auto">
            <span className="text-muted-foreground">Всего: <b className="text-foreground">{session.summary.total}</b></span>
            <span className="text-muted-foreground">Готово: <b className="text-foreground">{session.summary.ready}</b></span>
            <span className="text-muted-foreground">Удалено: <b className="text-foreground">{session.summary.deleted}</b></span>
            <span className="text-muted-foreground">Фото: <b className="text-foreground">{session.summary.photos}</b></span>
            <span className="text-muted-foreground">
              Остаток XML: <b className="text-foreground">{session.dropStockQuantity == null ? "не задан" : session.dropStockQuantity}</b>
            </span>
          </div>
        </div>
      )}

      <div className="app-content mx-auto w-full max-w-[1600px] lg:px-8">
        <div className="space-y-3">
          {historyOpen && history.length > 0 && (
            <Card>
              <CardContent className="space-y-3 p-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold">История сохранений</p>
                    <p className="text-xs text-muted-foreground">Можно продолжить работу без созданного XML.</p>
                  </div>
                  <Button size="sm" variant="outline" onClick={() => run(refreshHistory)}>Обновить</Button>
                </div>
                <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                  {history.map((item) => (
                    <button
                      key={item.id}
                      className={`rounded-md border p-3 text-left transition-colors hover:border-primary/30 hover:bg-accent/45 ${session?.id === item.id ? "border-primary/40 bg-accent" : "border-border"}`}
                      onClick={() => run(() => openSession(item.id))}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold">{item.sourceName || "Сохранение"}</p>
                          <p className="text-xs text-muted-foreground">Изменено: {formatDate(item.updatedAt)}</p>
                        </div>
                        <span className="rounded bg-secondary px-2 py-1 text-xs font-semibold">{item.summary.ready}/{item.summary.active}</span>
                      </div>
                      <div className="mt-2 flex gap-3 text-xs text-muted-foreground">
                        <span>Всего {item.summary.total}</span>
                        <span>Удалено {item.summary.deleted}</span>
                        <span>Фото {item.summary.photos}</span>
                      </div>
                    </button>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {!session && (
            <Card><CardContent className="p-6 text-center lg:p-10">
              <UploadCloud className="mx-auto mb-3 h-10 w-10 text-muted-foreground" />
              <p className="text-sm font-semibold">Загрузи архив .zip, .rar или .7z</p>
              <p className="mt-1 text-xs text-muted-foreground">После распаковки здесь появятся карточки товаров с первым фото.</p>
            </CardContent></Card>
          )}

          {error && <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">{error}</div>}
          {autoloadStopMessage && (
            <div className="rounded-md border border-warning/25 bg-warning/10 p-3 text-sm text-warning">
              {autoloadStopMessage}
            </div>
          )}
          <AdIdsBlock title="ID последнего XML" adIds={lastXmlAdIds} />
          {lastXmlStockStatus && (
            <div className="rounded-md border border-success/25 bg-success/10 p-3 text-sm text-success">
              <p className="font-semibold">Проверка остатка в XML</p>
              <p className="mt-1 text-xs opacity-80">{lastXmlStockStatus.message}</p>
            </div>
          )}
          {publishResult && (
            <div className="rounded-md border border-success/25 bg-success/10 p-3 text-sm text-success">
              <p className="font-semibold">Публикация Avito запущена</p>
              <p className="mt-1 text-xs opacity-80">
                Avito принял XML-фид в автозагрузку. Итог публикации появится в отчётах Автозагрузки Avito после обработки.
              </p>
              {publishResult.profileWarning && (
                <p className="mt-1 text-xs font-medium opacity-90">{publishResult.profileWarning}</p>
              )}
              {publishResult.feedUrl && (
                <a
                  href={publishResult.feedUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-2 block truncate text-xs font-medium underline underline-offset-2"
                >
                  {publishResult.feedUrl}
                </a>
              )}
              <div className="mt-2 flex flex-wrap gap-2 text-xs">
                {publishResult.profileStatus && <span>Профиль: HTTP {publishResult.profileStatus}</span>}
                {publishResult.uploadStatus && <span>Запуск: HTTP {publishResult.uploadStatus}</span>}
                <span>{publishResult.legacyIds ? "Старые ID" : "Новые профильные ID"}</span>
              </div>
              {publishResult.master && (
                <div className="mt-2 rounded-md border border-success/25 bg-background/45 p-2 text-xs">
                  <p className="font-semibold">Защита мастер-фида: старые объявления сохранены</p>
                  <p className="mt-1 opacity-80">
                    Было {publishResult.master.previousAds} · добавлено {publishResult.master.addedAds} · обновлено {publishResult.master.updatedAds} · удалено {publishResult.master.removedAds} · всего {publishResult.master.totalAds}
                  </p>
                </div>
              )}
            </div>
          )}
          {publishResult?.adIds && <AdIdsBlock title="ID опубликованных объявлений" adIds={publishResult.adIds} />}
          {autoloadStatus && (
            <div className="rounded-md border border-info/25 bg-info/10 p-3 text-sm text-info">
              <p className="font-semibold">Статус автозагрузки Avito</p>
              <div className="mt-2 grid gap-1 text-xs">
                <p><span className="font-medium">Текущая:</span> {uploadLine(autoloadStatus.current)}</p>
                <p><span className="font-medium">Последняя успешная:</span> {uploadLine(autoloadStatus.lastSuccessful)}</p>
              </div>
              {uploadStatLines(autoloadStatus.current).length > 0 && (
                <div className="mt-2 space-y-1 text-xs">
                  <p className="font-medium">Разбивка текущей загрузки</p>
                  {uploadStatLines(autoloadStatus.current).map((line) => (
                    <p key={line}>{line}</p>
                  ))}
                </div>
              )}
              {autoloadStatus.uploads && autoloadStatus.uploads.length > 0 && (
                <div className="mt-2 space-y-1 text-xs">
                  <p className="font-medium">Последние запуски</p>
                  {autoloadStatus.uploads.slice(0, 5).map((upload, index) => (
                    <p key={`${upload.upload_id ?? index}`}>{uploadLine(upload)}</p>
                  ))}
                </div>
              )}
            </div>
          )}

          {session && (
            <Card className="sticky top-[132px] z-20 lg:top-[142px]"><CardContent className="space-y-3 p-3">
              <input
                ref={customXmlRef}
                type="file"
                accept=".xml,text/xml,application/xml"
                className="hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) run(() => selectCustomXml(file));
                }}
              />
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                <Button size="sm" variant="outline" onClick={() => setSelected(allVisibleSelected ? new Set() : new Set(filtered.map((p) => p.index)))}>{allVisibleSelected ? "Снять выбор" : "Выбрать видимые"}</Button>
                  {selected.size > 0 && (
                    <details className="relative">
                      <summary className="flex h-8 cursor-pointer list-none items-center gap-2 rounded-md border border-input bg-background px-3 text-xs font-medium shadow-sm hover:bg-accent">
                        <Check className="h-4 w-4" />
                        Действия · {selected.size}
                      </summary>
                      <div className="absolute left-0 top-full z-40 mt-2 w-72 space-y-2 rounded-md border border-border bg-popover p-3 text-popover-foreground shadow-lg">
                        <Button className="w-full justify-start" size="sm" variant="outline" onClick={() => run(() => patch({ ids: selectedIds, bulkOriginalTitle: true }))}>
                          <Check className="h-4 w-4" />
                          Название из папки
                        </Button>
                        <div className="flex gap-2">
                          <Input className="h-8 min-w-0" placeholder="Цена" value={bulkPrice} onChange={(e) => setBulkPrice(e.target.value)} />
                          <Button size="sm" variant="outline" disabled={!bulkPrice} onClick={() => run(() => patch({ ids: selectedIds, bulkPrice }))}>Одна цена</Button>
                        </div>
                        <Button className="w-full justify-start" size="sm" variant="destructive" onClick={() => run(() => patch({ ids: selectedIds, deleteSelected: true }))}>
                          <Trash2 className="h-4 w-4" />
                          Удалить выбранные
                        </Button>
                      </div>
                    </details>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button size="sm" disabled={status === "generating"} onClick={() => run(generateXml)}>
                    <Download className="h-4 w-4" />
                    XML
                  </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!hasPublishAuth || manualPublishCredentialsPartial || publishing || publishLegacyIds}
                  onClick={() => run(publishXml)}
                >
                  {publishing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  Публикация
                </Button>
                  <details className="relative">
                    <summary className="flex h-8 w-8 cursor-pointer list-none items-center justify-center rounded-md border border-input bg-background shadow-sm hover:bg-accent" aria-label="Другие действия">
                      <MoreHorizontal className="h-4 w-4" />
                    </summary>
                    <div className="absolute right-0 top-full z-40 mt-2 w-56 space-y-1 rounded-md border border-border bg-popover p-1.5 text-popover-foreground shadow-lg">
                      <Button className="w-full justify-start" size="sm" variant="ghost" disabled={publishingCustomXml} onClick={() => customXmlRef.current?.click()}>
                        <UploadCloud className="h-4 w-4" />
                        Готовый XML
                      </Button>
                      <Button className="w-full justify-start" size="sm" variant="ghost" disabled={!hasPublishAuth || manualPublishCredentialsPartial || publishStatusLoading} onClick={() => run(checkAutoloadStatus)}>
                        {publishStatusLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <History className="h-4 w-4" />}
                        Статус автозагрузки
                      </Button>
                      <Button className="w-full justify-start" size="sm" variant="ghost" disabled={!hasPublishAuth || manualPublishCredentialsPartial || stoppingAutoload} onClick={() => run(stopAutoload)}>
                        {stoppingAutoload ? <Loader2 className="h-4 w-4 animate-spin" /> : <X className="h-4 w-4" />}
                        Остановить
                      </Button>
                    </div>
                  </details>
                </div>
              </div>
              {customXmlFile && (
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-primary/25 bg-accent/60 p-3 text-sm">
                  <div className="min-w-0">
                    <p className="truncate font-semibold">{customXmlFile.name}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Проверено: {customXmlAdIds.length} объявлений с уникальными ID. Будет опубликовано в выбранный профиль.
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={publishingCustomXml}
                      onClick={() => {
                        setCustomXmlFile(null);
                        setCustomXmlAdIds([]);
                        if (customXmlRef.current) customXmlRef.current.value = "";
                      }}
                    >
                      Отмена
                    </Button>
                    <Button
                      size="sm"
                      disabled={!hasPublishAuth || manualPublishCredentialsPartial || publishingCustomXml}
                      onClick={() => run(publishCustomXml)}
                    >
                      {publishingCustomXml ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                      Опубликовать файл
                    </Button>
                  </div>
                </div>
              )}
              <details className="rounded-md border border-border/80 bg-background/45">
                <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-xs font-semibold text-muted-foreground hover:text-foreground">
                  <SlidersHorizontal className="h-4 w-4" />
                  Настройки публикации
                </summary>
                <div className="space-y-3 border-t border-border/80 p-3">
                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold">Города XML</p>
                        <p className="text-xs text-muted-foreground">На каждый отмеченный адрес создаётся отдельное объявление.</p>
                      </div>
                      <span className="shrink-0 text-xs font-medium text-muted-foreground">
                        Выбрано {session.locations.filter((location) => location.enabled).length}
                      </span>
                    </div>
                    <div className="divide-y divide-border/70 rounded-md border border-border/80 bg-background">
                      {session.locations.map((location, locationIndex) => (
                        <div key={`${location.city}-${location.address}`} className="flex min-h-12 items-start gap-3 px-3 py-2.5">
                          <input
                            type="checkbox"
                            aria-label={`Добавлять ${location.city} в XML`}
                            className="mt-0.5 h-4 w-4 shrink-0 accent-primary"
                            checked={location.enabled}
                            disabled={status === "saving"}
                            onChange={() => run(() => toggleLocation(locationIndex))}
                          />
                          <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium leading-4">{location.city}</p>
                            <p className="mt-1 text-xs leading-4 text-muted-foreground">{location.address}</p>
                          </div>
                          {location.custom && (
                            <button
                              type="button"
                              aria-label={`Удалить адрес ${location.city}`}
                              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                              disabled={status === "saving"}
                              onClick={() => run(() => removeLocation(locationIndex))}
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                    <div className="grid gap-2 md:grid-cols-[minmax(140px,0.7fr)_minmax(260px,1.3fr)_auto]">
                      <Input
                        aria-label="Новый город XML"
                        placeholder="Город"
                        value={newLocationCity}
                        onChange={(event) => setNewLocationCity(event.target.value)}
                      />
                      <Input
                        aria-label="Полный адрес нового города"
                        placeholder="Полный адрес: улица, дом"
                        value={newLocationAddress}
                        onChange={(event) => setNewLocationAddress(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            event.preventDefault();
                            run(addLocation);
                          }
                        }}
                      />
                      <Button
                        type="button"
                        variant="outline"
                        disabled={status === "saving" || !newLocationCity.trim() || !newLocationAddress.trim()}
                        onClick={() => run(addLocation)}
                      >
                        <Plus className="h-4 w-4" />
                        Добавить город
                      </Button>
                    </div>
                  </div>
                  <div className="max-w-xl space-y-1">
                    <Label htmlFor="botv-avito-profile">Профиль Avito</Label>
                    <AvitoProfileSelect
                      id="botv-avito-profile"
                      profiles={publishProfiles}
                      value={selectedPublishProfileId}
                      onValueChange={(value) => {
                        setSelectedPublishProfileId(value);
                        setManualPublishClientId("");
                        setManualPublishClientSecret("");
                      }}
                    />
                    {selectedPublishProfile && !selectedPublishProfile.hasCredentials && !manualPublishCredentialsComplete && (
                      <p className="text-xs font-medium text-warning">Для публикации XML этому профилю нужны API-ключи Avito.</p>
                    )}
                  </div>
                  <div className="grid gap-2 md:grid-cols-3">
                    <Input placeholder="client_id вручную" value={manualPublishClientId} onChange={(event) => setManualPublishClientId(event.target.value)} autoComplete="off" />
                    <Input placeholder="client_secret вручную" type="password" value={manualPublishClientSecret} onChange={(event) => setManualPublishClientSecret(event.target.value)} autoComplete="new-password" />
                    <Input placeholder="Email отчётов XML" type="email" value={manualPublishReportEmail} onChange={(event) => setManualPublishReportEmail(event.target.value)} />
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Input className="h-8 w-40" inputMode="numeric" placeholder="Остаток дропа" value={dropStockInput} onChange={(e) => setDropStockInput(e.target.value)} />
                    <Button size="sm" variant="outline" onClick={() => run(saveDropStockQuantity)}>
                      <PackageCheck className="h-4 w-4" />
                      Остаток XML
                    </Button>
                    {dropStockStatus && <span className="max-w-[480px] text-xs text-muted-foreground">{dropStockStatus}</span>}
                  </div>
                  <div className="rounded-md border border-success/25 bg-success/10 p-3 text-xs text-success">
                    <p className="font-semibold">Безопасная публикация через мастер-фид</p>
                    <p className="mt-1 opacity-80">Новый дроп добавляется к предыдущим объявлениям выбранного профиля. Если старые ID исчезают, публикация блокируется до отправки в Avito.</p>
                  </div>
                  <label className="flex items-start gap-2 rounded-md border border-warning/25 bg-warning/10 p-3 text-xs text-warning">
                    <input type="checkbox" className="mt-0.5 h-4 w-4" checked={publishLegacyIds} onChange={(event) => setPublishLegacyIds(event.target.checked)} />
                    <span>
                      <span className="block font-semibold">XML и публикация со старыми ID</span>
                      <span className="mt-1 block opacity-80">Только для ручного восстановления: XML будет скачан с ID SKU-1, SKU-2... Автопубликация со старыми ID отключена, потому что они могут перезаписать другой дроп.</span>
                    </span>
                  </label>
                </div>
              </details>
            </CardContent></Card>
          )}

          <div className="grid gap-3 xl:grid-cols-2 2xl:grid-cols-3">
            {filtered.map((product) => (
              <Card key={product.id} className={product.deleted ? "opacity-45" : "cursor-pointer transition-colors hover:border-primary/25 hover:bg-accent/45"} onClick={() => openPreview(product)}>
                <CardContent className="flex gap-3 p-3">
                  <button className="mt-4 h-5 w-5 rounded border border-input text-xs" onClick={(e) => { e.stopPropagation(); toggle(product.index); }}>{selected.has(product.index) ? "✓" : ""}</button>
                  <button className="h-16 w-16 shrink-0 overflow-hidden rounded-md bg-muted" onClick={(e) => { e.stopPropagation(); openPreview(product); }}>
                    {product.firstPhoto && session ? <img src={photoUrl(session.id, product.firstPhoto, { thumb: true, size: 160 })} alt="" className="h-full w-full object-cover" loading="lazy" decoding="async" /> : <div className="flex h-full w-full items-center justify-center text-muted-foreground"><ImageIcon className="h-5 w-5" /></div>}
                  </button>
                  <div className="min-w-0 flex-1 space-y-2">
                    <div className="flex gap-2">
                      <div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold">#{product.index} {product.name}</p><p className="text-xs text-muted-foreground">{product.photoCount} фото · {formatRub(product.price)}</p></div>
                    </div>
                    <Input value={product.adTitle} disabled={product.useOriginalTitle || product.deleted} onClick={(e) => e.stopPropagation()} onChange={(e) => updateLocalProduct(product.index, { adTitle: e.target.value })} onBlur={(e) => run(() => saveProductTitle(product.index, e.currentTarget.value))} />
                    <div className="flex gap-2">
                      <Input inputMode="numeric" placeholder="Цена" value={product.price ?? ""} disabled={product.deleted} onClick={(e) => e.stopPropagation()} onChange={(e) => updateLocalProduct(product.index, { price: e.target.value ? Number(e.target.value) : null })} onBlur={(e) => run(() => saveProductPrice(product.index, e.currentTarget.value ? Number(e.currentTarget.value) : null))} />
                      <select
                        aria-label="Цвет товара"
                        className="h-10 min-w-32 rounded-md border border-input bg-background px-3 text-sm"
                        value={product.color}
                        disabled={product.deleted}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => {
                          const color = e.target.value as ProductColor;
                          run(() => saveProductColor(product, color));
                        }}
                      >
                        {PRODUCT_COLORS.map((color) => <option key={color} value={color}>{color}</option>)}
                      </select>
                      <details className="relative" onClick={(e) => e.stopPropagation()}>
                        <summary className="flex h-10 w-10 cursor-pointer list-none items-center justify-center rounded-md border border-input bg-background hover:bg-accent" aria-label="Действия с товаром">
                          <MoreHorizontal className="h-4 w-4" />
                        </summary>
                        <div className="absolute right-0 top-full z-30 mt-2 w-56 space-y-1 rounded-md border border-border bg-popover p-1.5 text-popover-foreground shadow-lg">
                          <Button className="w-full justify-start" size="sm" variant="ghost" onClick={() => run(() => toggleOriginalTitle(product))}>
                            <Package className="h-4 w-4" />
                            {product.useOriginalTitle ? "Редактировать название" : "Название из папки"}
                          </Button>
                          <Button className="w-full justify-start" size="sm" variant="ghost" onClick={() => run(() => toggleDeleted(product))}>
                            {product.deleted ? <X className="h-4 w-4" /> : <Trash2 className="h-4 w-4" />}
                            {product.deleted ? "Восстановить" : "Удалить карточку"}
                          </Button>
                        </div>
                      </details>
                    </div>
                    <details className="rounded-md border border-border/70 bg-background/35" onClick={(e) => e.stopPropagation()}>
                      <summary className="flex min-h-9 cursor-pointer list-none items-center gap-2 px-2.5 py-2 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground">
                        <SlidersHorizontal className="h-3.5 w-3.5" />
                        Описание и фотографии
                        <span className="ml-auto">{product.photoCount} фото</span>
                      </summary>
                      <div className="space-y-3 border-t border-border/70 p-2.5">
                        <Textarea
                          value={product.description}
                          disabled={product.deleted}
                          placeholder="Описание для XML"
                          className="min-h-24 resize-y text-xs leading-5"
                          onChange={(e) => updateLocalProduct(product.index, { description: e.target.value })}
                          onBlur={(e) => run(() => saveProductDescription(product.index, e.currentTarget.value))}
                        />
                        {product.photos.length > 1 && (
                          <div className="flex gap-1.5 overflow-x-auto pb-1">
                            {product.photos.slice(0, 8).map((token, photoIndex) => (
                              <div key={token} className="group/photo relative h-16 w-16 shrink-0 overflow-hidden rounded-md border border-border bg-muted">
                                {session && <img src={photoUrl(session.id, token, { thumb: true, size: 128 })} alt="" className="h-full w-full object-cover" loading="lazy" decoding="async" />}
                                <span className="absolute left-1 top-1 rounded bg-background/85 px-1 text-[10px] font-semibold">{photoIndex + 1}</span>
                                <div className="absolute inset-x-0 bottom-0 flex translate-y-full justify-center gap-0.5 bg-background/90 p-0.5 opacity-0 transition-[transform,opacity] group-hover/photo:translate-y-0 group-hover/photo:opacity-100 focus-within:translate-y-0 focus-within:opacity-100">
                                  <button type="button" aria-label="Сделать фото первым" title="Сделать первой" className="flex h-7 w-7 items-center justify-center rounded hover:bg-accent" onClick={() => run(() => movePhoto(product, token, "first"))}><PanelTop className="h-3.5 w-3.5" /></button>
                                  <button type="button" aria-label="Сдвинуть фото влево" title="Сдвинуть влево" className="flex h-7 w-7 items-center justify-center rounded hover:bg-accent" onClick={() => run(() => movePhoto(product, token, "left"))}><ArrowLeft className="h-3.5 w-3.5" /></button>
                                  <button type="button" aria-label="Сдвинуть фото вправо" title="Сдвинуть вправо" className="flex h-7 w-7 items-center justify-center rounded hover:bg-accent" onClick={() => run(() => movePhoto(product, token, "right"))}><ArrowRight className="h-3.5 w-3.5" /></button>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </details>
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
                <p className="mt-1 text-sm text-muted-foreground">Можно скачать несколько XML подряд: номер заменится во всех объявлениях, окно останется открытым.</p>
                {replacementXmlCount > 0 && (
                  <p className="mt-2 text-xs font-medium text-primary">Дополнительных XML скачано: {replacementXmlCount}</p>
                )}
              </div>
              <Input placeholder="+7 999 000 00 00" value={replacementPhone} onChange={(e) => setReplacementPhone(e.target.value)} />
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setPhonePromptOpen(false)}>Готово</Button>
                <Button disabled={!replacementPhone.trim() || status === "generating"} onClick={() => run(downloadReplacementXml)}>
                  {status === "generating" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                  Скачать ещё
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
