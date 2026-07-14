"use client";

import type { ReactNode } from "react";
import { useState } from "react";
import { ArrowLeft, BarChart3, CheckCircle2, ExternalLink, Eye, FileJson, Globe2, Loader2, Search, ShieldAlert } from "lucide-react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "@/lib/hooks/use-toast";

type ProbeResult = {
  requestedUrl: string;
  finalUrl: string;
  status: number;
  ok: boolean;
  contentType: string;
  bytes: number;
  fetchedAt: string;
  pageTitle: string | null;
  pageType: "ad" | "search" | "unknown";
  itemId: string | null;
  views: number | null;
  viewCandidates: string[];
  listingPreviews: { id: string | null; url: string }[];
  signals: {
    hasNextData: boolean;
    jsonScriptCount: number;
    likelyCaptcha: boolean;
    likelyJsRequired: boolean;
  };
  notes: string[];
};

export function MarketAnalysisClient() {
  const [mode, setMode] = useState<"url" | "search">("url");
  const [url, setUrl] = useState("");
  const [query, setQuery] = useState("футболки");
  const [city, setCity] = useState("moskva");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ProbeResult | null>(null);

  async function probe() {
    setLoading(true);
    try {
      const response = await fetch("/api/avito/market-analysis/probe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          mode === "url"
            ? { mode, url }
            : { mode, query, city },
        ),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Не удалось проверить Авито");
      setResult(data);
      toast({
        title: "Проверка завершена",
        description: data.views === null ? "Счетчик просмотров не найден в HTML." : `Просмотры: ${data.views}`,
      });
    } catch (error) {
      toast({
        title: "Ошибка проверки",
        description: error instanceof Error ? error.message : String(error),
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }

  const canSubmit = mode === "url" ? url.trim().length > 0 : query.trim().length > 0;

  return (
    <div className="app-shell">
      <div className="app-header">
        <div className="mb-3 flex items-center gap-3">
          <Link href="/settings" className="icon-tile h-9 w-9">
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div className="min-w-0 flex-1">
            <h1 className="text-lg font-semibold tracking-tight">Аналитика объявлений</h1>
            <p className="section-caption">Проверка публичных страниц Авито перед сбором данных</p>
          </div>
          <Button size="sm" onClick={probe} disabled={!canSubmit || loading}>
            {loading ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Search className="mr-1 h-4 w-4" />}
            Проверить
          </Button>
        </div>

        <Tabs value={mode} onValueChange={(value) => setMode(value as "url" | "search")}>
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="url">Ссылка</TabsTrigger>
            <TabsTrigger value="search">Поиск</TabsTrigger>
          </TabsList>
          <TabsContent value="url" className="mt-3 space-y-1">
            <Label htmlFor="avito-url">Ссылка на объявление или выдачу</Label>
            <Input
              id="avito-url"
              placeholder="https://www.avito.ru/..."
              value={url}
              onChange={(event) => setUrl(event.target.value)}
            />
          </TabsContent>
          <TabsContent value="search" className="mt-3 grid gap-3 sm:grid-cols-[1fr_140px]">
            <div className="space-y-1">
              <Label htmlFor="avito-query">Запрос</Label>
              <Input
                id="avito-query"
                placeholder="футболки"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="avito-city">Город в URL</Label>
              <Input
                id="avito-city"
                placeholder="moskva"
                value={city}
                onChange={(event) => setCity(event.target.value)}
              />
            </div>
          </TabsContent>
        </Tabs>
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
                  Ответ страницы
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 p-4 pt-0">
                <div className="flex flex-wrap gap-2">
                  <Badge variant={result.ok ? "success" : "destructive"}>HTTP {result.status}</Badge>
                  <Badge variant="secondary">{pageTypeLabel(result.pageType)}</Badge>
                  <Badge variant="outline">{formatBytes(result.bytes)}</Badge>
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
                icon={<Eye className="h-4 w-4" />}
                label="Просмотры"
                value={result.views === null ? "не найдены" : String(result.views)}
                muted={result.views === null}
              />
              <MetricCard
                icon={<FileJson className="h-4 w-4" />}
                label="JSON на странице"
                value={result.signals.hasNextData ? "__NEXT_DATA__" : `${result.signals.jsonScriptCount} script`}
              />
            </div>

            {result.itemId && (
              <Card>
                <CardContent className="flex items-center justify-between p-4">
                  <div>
                    <p className="text-xs text-muted-foreground">ID объявления</p>
                    <p className="font-mono text-sm font-semibold">{result.itemId}</p>
                  </div>
                  <CheckCircle2 className="h-5 w-5 text-primary" />
                </CardContent>
              </Card>
            )}

            {result.viewCandidates.length > 0 && (
              <Card>
                <CardHeader className="p-4 pb-2">
                  <CardTitle className="text-sm">Кандидаты на счетчик просмотров</CardTitle>
                </CardHeader>
                <CardContent className="flex flex-wrap gap-2 p-4 pt-0">
                  {result.viewCandidates.map((candidate) => (
                    <Badge key={candidate} variant="info">{candidate}</Badge>
                  ))}
                </CardContent>
              </Card>
            )}

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

            <Card>
              <CardHeader className="p-4 pb-2">
                <CardTitle className="flex items-center gap-2 text-sm">
                  <ShieldAlert className="h-4 w-4" />
                  Вывод
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 p-4 pt-0">
                {result.notes.length > 0 ? (
                  result.notes.map((note) => (
                    <p key={note} className="text-sm text-muted-foreground">{note}</p>
                  ))
                ) : (
                  <p className="text-sm text-muted-foreground">Страница прочитана, явных ограничений не найдено.</p>
                )}
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </div>
  );
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
  if (type === "ad") return "объявление";
  if (type === "search") return "выдача";
  return "неизвестно";
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} КБ`;
  return `${(bytes / 1024 / 1024).toFixed(1)} МБ`;
}
