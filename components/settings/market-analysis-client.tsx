"use client";

import type { ReactNode } from "react";
import { useState } from "react";
import { ArrowLeft, BarChart3, CheckCircle2, ExternalLink, FileJson, Globe2, Loader2, Search, ShieldAlert } from "lucide-react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/lib/hooks/use-toast";

const LOCAL_AGENT_URL = "http://127.0.0.1:3217/api/avito/market-analysis/probe";

type ProbeResult = {
  requestedUrl: string;
  finalUrl: string;
  status: number;
  ok: boolean;
  contentType: string;
  bytes: number;
  fetchedAt: string;
  category: string;
  periodDays: number;
  pageTitle: string | null;
  pageType: "search" | "unknown";
  itemId: null;
  views: null;
  viewCandidates: string[];
  listingPreviews: { id: string | null; url: string }[];
  signals: {
    hasNextData: boolean;
    jsonScriptCount: number;
    likelyCaptcha: boolean;
    likelyJsRequired: boolean;
  };
  notes: string[];
  listings: Array<{
    id: string | null;
    url: string;
    title: string | null;
    views: number | null;
    publishedAt: string | null;
    ageDays: number | null;
    status: number;
    ok: boolean;
    note: string | null;
  }>;
  summary: {
    checked: number;
    withViews: number;
    totalViews: number;
    averageViews: number | null;
    maxViews: number | null;
  };
};

export function MarketAnalysisClient() {
  const [category, setCategory] = useState("футболки");
  const [periodDays, setPeriodDays] = useState(3);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ProbeResult | null>(null);

  async function probe() {
    setLoading(true);
    try {
      const response = await fetch(LOCAL_AGENT_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category, periodDays }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Не удалось проверить Авито через локальный агент");
      const normalized = normalizeProbeResult(data);
      setResult(normalized);
      toast({
        title: "Проверка завершена",
        description: `Локальный агент проверил карточек: ${data.summary?.checked ?? 0}`,
      });
    } catch (error) {
      const message =
        error instanceof TypeError
          ? "Локальный агент Avito не запущен или недоступен. Запустите на этом ПК: npm run avito:local-agent"
          : error instanceof Error
            ? error.message
            : String(error);
      toast({
        title: "Ошибка проверки",
        description: message,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }

  const canSubmit = category.trim().length > 0 && periodDays >= 1 && periodDays <= 30;

  return (
    <div className="app-shell">
      <div className="app-header">
        <div className="mb-3 flex items-center gap-3">
          <Link href="/settings" className="icon-tile h-9 w-9">
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div className="min-w-0 flex-1">
            <h1 className="text-lg font-semibold tracking-tight">Аналитика объявлений</h1>
            <p className="section-caption">Проверка публичной выдачи Авито по категории и периоду</p>
          </div>
          <Button size="sm" onClick={probe} disabled={!canSubmit || loading}>
            {loading ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Search className="mr-1 h-4 w-4" />}
            Проверить
          </Button>
        </div>

        <div className="grid gap-3 sm:grid-cols-[140px_1fr]">
          <div className="space-y-1">
            <Label htmlFor="avito-period">Период, дней</Label>
            <Input
              id="avito-period"
              type="number"
              min={1}
              max={30}
              value={periodDays}
              onChange={(event) => setPeriodDays(Number(event.target.value))}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="avito-category">Категория</Label>
            <Input
              id="avito-category"
              placeholder="футболки"
              value={category}
              onChange={(event) => setCategory(event.target.value)}
            />
          </div>
        </div>
      </div>

      <div className="app-content space-y-3">
        {!result && !loading && (
          <div className="py-12 text-center text-muted-foreground">
            <BarChart3 className="mx-auto mb-3 h-10 w-10 opacity-45" />
            <p className="text-sm font-semibold">Запустите проверку, чтобы увидеть, какие данные Авито отдает публично</p>
          </div>
        )}

        {result && (
          <>
            <Card>
              <CardHeader className="p-4 pb-2">
                <CardTitle className="flex items-center gap-2 text-sm">
                  <Globe2 className="h-4 w-4" />
                  Ответ выдачи
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 p-4 pt-0">
                <div className="flex flex-wrap gap-2">
                  <Badge variant={result.ok ? "success" : "destructive"}>HTTP {result.status}</Badge>
                  <Badge variant="secondary">{pageTypeLabel(result.pageType)}</Badge>
                  <Badge variant="outline">{formatBytes(result.bytes)}</Badge>
                  <Badge variant="outline">{result.periodDays} дн.</Badge>
                  {result.signals.likelyCaptcha && <Badge variant="warning">проверка доступа</Badge>}
                </div>
                <div>
                  <p className="text-sm font-semibold">{result.pageTitle ?? "Заголовок не найден"}</p>
                  <a
                    href={result.finalUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-1 inline-flex max-w-full items-center gap-1 truncate text-xs text-primary"
                  >
                    <span className="truncate">{result.finalUrl}</span>
                    <ExternalLink className="h-3.5 w-3.5 shrink-0" />
                  </a>
                </div>
              </CardContent>
            </Card>

            <div className="grid gap-3 sm:grid-cols-2">
              <MetricCard
                icon={<CheckCircle2 className="h-4 w-4" />}
                label="Проверено карточек"
                value={String(result.summary.checked)}
                muted={result.summary.checked === 0}
              />
              <MetricCard
                icon={<FileJson className="h-4 w-4" />}
                label="Просмотры найдены"
                value={result.summary.withViews ? `${result.summary.totalViews} всего` : "нет"}
                muted={result.summary.withViews === 0}
              />
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <MetricCard
                icon={<BarChart3 className="h-4 w-4" />}
                label="Средние просмотры"
                value={result.summary.averageViews == null ? "нет данных" : String(result.summary.averageViews)}
                muted={result.summary.averageViews == null}
              />
              <MetricCard
                icon={<BarChart3 className="h-4 w-4" />}
                label="Максимум просмотров"
                value={result.summary.maxViews == null ? "нет данных" : String(result.summary.maxViews)}
                muted={result.summary.maxViews == null}
              />
            </div>

            {result.listingPreviews.length > 0 && (
              <Card>
                <CardHeader className="p-4 pb-2">
                  <CardTitle className="text-sm">Найденные объявления в HTML</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 p-4 pt-0">
                  {result.listingPreviews.slice(0, 8).map((item) => (
                    <a
                      key={item.url}
                      href={item.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center justify-between gap-3 rounded-md px-2 py-2 text-sm hover:bg-secondary/70"
                    >
                      <span className="min-w-0 truncate">{item.id ? `ID ${item.id}` : item.url}</span>
                      <ExternalLink className="h-4 w-4 shrink-0 text-muted-foreground" />
                    </a>
                  ))}
                </CardContent>
              </Card>
            )}

            {result.listings.length > 0 && (
              <Card>
                <CardHeader className="p-4 pb-2">
                  <CardTitle className="text-sm">Проверенные объявления</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 p-4 pt-0">
                  {result.listings.map((item) => (
                    <a
                      key={item.url}
                      href={item.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center justify-between gap-3 rounded-md px-2 py-2 text-sm hover:bg-secondary/70"
                    >
                      <span className="min-w-0">
                        <span className="block truncate font-medium">{item.title ?? item.id ?? item.url}</span>
                        <span className="block text-xs text-muted-foreground">
                          {item.publishedAt ?? "дата не найдена"} · {item.note ?? `HTTP ${item.status}`}
                        </span>
                      </span>
                      <span className="shrink-0 text-sm font-semibold tabular-nums">
                        {item.views == null ? "—" : item.views}
                      </span>
                    </a>
                  ))}
                </CardContent>
              </Card>
            )}

            <Card>
              <CardHeader className="p-4 pb-2">
                <CardTitle className="flex items-center gap-2 text-sm">
                  <ShieldAlert className="h-4 w-4" />
                  Вывод
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 p-4 pt-0">
                {result.notes.map((note) => (
                  <p key={note} className="text-sm text-muted-foreground">{note}</p>
                ))}
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </div>
  );
}

function normalizeProbeResult(data: Partial<ProbeResult>): ProbeResult {
  const listingPreviews = data.listingPreviews ?? [];
  return {
    requestedUrl: data.requestedUrl ?? "",
    finalUrl: data.finalUrl ?? data.requestedUrl ?? "",
    status: data.status ?? 0,
    ok: data.ok ?? false,
    contentType: data.contentType ?? "",
    bytes: data.bytes ?? 0,
    fetchedAt: data.fetchedAt ?? new Date().toISOString(),
    category: data.category ?? "",
    periodDays: data.periodDays ?? 3,
    pageTitle: data.pageTitle ?? null,
    pageType: data.pageType ?? (listingPreviews.length > 0 ? "search" : "unknown"),
    itemId: null,
    views: null,
    viewCandidates: data.viewCandidates ?? [],
    listingPreviews,
    signals: data.signals ?? {
      hasNextData: false,
      jsonScriptCount: 0,
      likelyCaptcha: false,
      likelyJsRequired: false,
    },
    notes: data.notes ?? [],
    listings: data.listings ?? [],
    summary: data.summary ?? {
      checked: listingPreviews.length,
      withViews: 0,
      totalViews: 0,
      averageViews: null,
      maxViews: null,
    },
  };
}

function MetricCard({
  icon,
  label,
  value,
  muted = false,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  muted?: boolean;
}) {
  return (
    <Card>
      <CardContent className="flex items-center gap-3 p-4">
        <div className="icon-tile h-9 w-9">{icon}</div>
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">{label}</p>
          <p className={`truncate text-sm font-semibold ${muted ? "text-muted-foreground" : ""}`}>{value}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function pageTypeLabel(type: ProbeResult["pageType"]): string {
  if (type === "search") return "выдача";
  return "неизвестно";
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} КБ`;
  return `${(bytes / 1024 / 1024).toFixed(1)} МБ`;
}
