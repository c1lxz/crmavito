"use client";

import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, BarChart3, CheckCircle2, ExternalLink, FileJson, Globe2, Heart, KeyRound, Loader2, MessageCircle, MousePointerClick, Search, ShieldAlert } from "lucide-react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/lib/hooks/use-toast";
import { AiAnalysisReport } from "@/components/settings/ai-analysis-report";

const LOCAL_AGENT_URL = "http://127.0.0.1:3217/api/avito/market-analysis/probe";
const LOCAL_AGENT_HEALTH_URL = "http://127.0.0.1:3217/health";

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

type AvitoCredentialProfile = {
  id: string;
  name: string;
  accountId: string | null;
  reportEmail: string | null;
  isActive: boolean;
};

type OwnAnalyticsItem = {
  itemId: string;
  title: string;
  url: string | null;
  status: string | null;
  views: number;
  contacts: number;
  favorites: number;
  price: number | null;
  description: string | null;
  imageCount: number | null;
};

type OwnAnalyticsResult = {
  profileId: string;
  accountId: string;
  periodDays: number;
  dateFrom: string;
  dateTo: string;
  total: {
    ads: number;
    views: number;
    contacts: number;
    favorites: number;
  };
  items: OwnAnalyticsItem[];
};

type RankingMetric = "views" | "favorites" | "contacts";

export function MarketAnalysisClient() {
  const [activeTab, setActiveTab] = useState<"own" | "market">("own");
  const [category, setCategory] = useState("футболки");
  const [marketPeriodDays, setMarketPeriodDays] = useState(3);
  const [marketLoading, setMarketLoading] = useState(false);
  const [marketResult, setMarketResult] = useState<ProbeResult | null>(null);
  const [credentialProfiles, setCredentialProfiles] = useState<AvitoCredentialProfile[]>([]);
  const [selectedProfileId, setSelectedProfileId] = useState("");
  const [manualClientId, setManualClientId] = useState("");
  const [manualClientSecret, setManualClientSecret] = useState("");
  const [manualCredentialsOpen, setManualCredentialsOpen] = useState(false);
  const [ownPeriodDays, setOwnPeriodDays] = useState(3);
  const [ownLoading, setOwnLoading] = useState(false);
  const [ownResult, setOwnResult] = useState<OwnAnalyticsResult | null>(null);
  const [rankingMetric, setRankingMetric] = useState<RankingMetric>("views");

  const selectedProfile = credentialProfiles.find((profile) => profile.id === selectedProfileId) ?? null;
  const canSubmitMarket = category.trim().length > 0 && marketPeriodDays >= 1 && marketPeriodDays <= 30;
  const manualCredentialsComplete = Boolean(manualClientId.trim() && manualClientSecret.trim());
  const manualCredentialsPartial = Boolean(manualClientId.trim() || manualClientSecret.trim()) && !manualCredentialsComplete;
  const canSubmitOwn = (manualCredentialsComplete || Boolean(selectedProfileId)) && !manualCredentialsPartial && ownPeriodDays >= 1 && ownPeriodDays <= 270 && !ownLoading;

  const rankedItems = useMemo(
    () => rankBy(ownResult?.items ?? [], rankingMetric),
    [ownResult, rankingMetric],
  );

  useEffect(() => {
    void refreshCredentialProfiles();
  }, []);

  async function refreshCredentialProfiles(preferredId?: string) {
    const response = await fetch("/api/avito-profiles/credentials", { cache: "no-store" });
    if (!response.ok) return;
    const data = await response.json();
    const profiles: AvitoCredentialProfile[] = Array.isArray(data.profiles) ? data.profiles : [];
    setCredentialProfiles(profiles);

    const selected =
      profiles.find((profile) => profile.id === (preferredId || selectedProfileId)) ??
      profiles[0];
    if (selected) setSelectedProfileId(selected.id);
  }

  async function probeMarket() {
    setMarketLoading(true);
    try {
      const agentReady = await waitForLocalAgent();
      if (!agentReady) {
        throw new TypeError("Local Avito agent is unavailable");
      }

      const response = await fetch(LOCAL_AGENT_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category, periodDays: marketPeriodDays }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Не удалось проверить Авито через локальный агент");
      const normalized = normalizeProbeResult(data);
      setMarketResult(normalized);
      toast({
        title: "Проверка завершена",
        description: `Локальный агент проверил карточек: ${data.summary?.checked ?? 0}`,
      });
    } catch (error) {
      const message =
        error instanceof TypeError
          ? "Локальный агент Avito не запущен. Один раз установите автозапуск на этом ПК: npm run avito:install-local-agent"
          : error instanceof Error
            ? error.message
            : String(error);
      toast({
        title: "Ошибка проверки",
        description: message,
        variant: "destructive",
      });
    } finally {
      setMarketLoading(false);
    }
  }

  async function loadOwnAnalytics() {
    setOwnLoading(true);
    try {
      const response = await fetch("/api/avito/ads-analytics", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(manualCredentialsComplete
            ? { clientId: manualClientId.trim(), clientSecret: manualClientSecret.trim() }
            : { profileId: selectedProfileId }),
          periodDays: ownPeriodDays,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Не удалось загрузить аналитику объявлений");
      setOwnResult(data);
      toast({
        title: "Аналитика загружена",
        description: `Объявлений: ${data.total?.ads ?? 0}`,
      });
    } catch (error) {
      toast({
        title: "Ошибка Avito",
        description: error instanceof Error ? error.message : String(error),
        variant: "destructive",
      });
    } finally {
      setOwnLoading(false);
    }
  }

  return (
    <div className="app-shell market-analysis-shell">
      <div className="app-header">
        <div className="mb-3 flex items-center gap-3">
          <Link href="/settings" className="icon-tile h-9 w-9">
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div className="min-w-0 flex-1">
            <h1 className="text-lg font-semibold tracking-tight">Аналитика объявлений</h1>
            <p className="section-caption">Общая проверка выдачи и API-аналитика ваших объявлений</p>
          </div>
        </div>

        <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as "own" | "market")}>
          <TabsList className="w-full justify-start overflow-x-auto sm:w-auto">
            <TabsTrigger value="own">Наши объявления</TabsTrigger>
            <TabsTrigger value="market">Общая</TabsTrigger>
          </TabsList>

          <TabsContent value="own" className="space-y-3">
            <div className="market-analysis-controls flex flex-col gap-3 sm:flex-row sm:items-end">
              <div className="w-full min-w-0 space-y-1 sm:w-auto">
                <Label htmlFor="own-avito-period">Период, дней</Label>
                <Input
                  id="own-avito-period"
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={3}
                  value={ownPeriodDays}
                  onFocus={(event) => event.currentTarget.select()}
                  onChange={(event) => setOwnPeriodDays(Number(event.target.value.replace(/\D/g, "")))}
                  className="tabular-nums"
                />
              </div>
              <div className="min-w-0 space-y-1">
                <Label htmlFor="own-avito-profile">Профиль Avito</Label>
                <Select
                  value={selectedProfileId}
                  onValueChange={(value) => {
                    setSelectedProfileId(value);
                    setManualClientId("");
                    setManualClientSecret("");
                  }}
                >
                  <SelectTrigger id="own-avito-profile" disabled={credentialProfiles.length === 0}>
                    <SelectValue placeholder={credentialProfiles.length ? "Выберите профиль" : "Нет сохранённых профилей"} />
                  </SelectTrigger>
                  <SelectContent>
                    {credentialProfiles.map((profile) => (
                      <SelectItem key={profile.id} value={profile.id}>
                        {profile.name}{profile.accountId ? ` · ${profile.accountId}` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button
                type="button"
                variant={manualCredentialsOpen ? "secondary" : "outline"}
                onClick={() => setManualCredentialsOpen((value) => !value)}
                className="h-10"
              >
                <KeyRound className="h-4 w-4" />
                Ручные ключи
              </Button>
              <Button className="h-10" onClick={loadOwnAnalytics} disabled={!canSubmitOwn}>
                {ownLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <BarChart3 className="h-4 w-4" />}
                Загрузить аналитику
              </Button>
            </div>

            {manualCredentialsOpen && (
              <div className="market-analysis-manual-credentials rounded-md border bg-secondary/35 p-3">
                <div className="grid gap-2 sm:grid-cols-2">
                  <div className="space-y-1">
                    <Label htmlFor="manual-avito-client-id">client_id</Label>
                    <Input
                      id="manual-avito-client-id"
                      placeholder="Введите client_id"
                      value={manualClientId}
                      onChange={(event) => setManualClientId(event.target.value)}
                      autoComplete="off"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="manual-avito-client-secret">client_secret</Label>
                    <Input
                      id="manual-avito-client-secret"
                      placeholder="Введите client_secret"
                      type="password"
                      value={manualClientSecret}
                      onChange={(event) => setManualClientSecret(event.target.value)}
                      autoComplete="new-password"
                    />
                  </div>
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                  Ручные ключи временно заменяют выбранный профиль и не сохраняются в браузере.
                </p>
              </div>
            )}
          </TabsContent>

          <TabsContent value="market" className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-[140px_1fr_auto] sm:items-end">
              <div className="space-y-1">
                <Label htmlFor="avito-period">Период, дней</Label>
                <Input
                  id="avito-period"
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={2}
                  value={marketPeriodDays}
                  onFocus={(event) => event.currentTarget.select()}
                  onChange={(event) => setMarketPeriodDays(Number(event.target.value.replace(/\D/g, "")))}
                  className="tabular-nums"
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
              <Button size="sm" onClick={probeMarket} disabled={!canSubmitMarket || marketLoading}>
                {marketLoading ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Search className="mr-1 h-4 w-4" />}
                Проверить
              </Button>
            </div>
          </TabsContent>
        </Tabs>
      </div>

      <div className="app-content market-analysis-content space-y-3">
        {activeTab === "own" && !ownResult && !ownLoading && (
          <div className="py-12 text-center text-muted-foreground">
            <BarChart3 className="mx-auto mb-3 h-10 w-10 opacity-45" />
            <p className="text-sm font-semibold">Выберите профиль и загрузите API-аналитику объявлений</p>
          </div>
        )}

        {activeTab === "own" && ownResult && (
          <>
            <section className="analytics-overview space-y-3">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Аналитика объявлений</p>
                  <h2 className="mt-1 text-xl font-semibold tracking-tight">Сводка за период</h2>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Badge variant="secondary">{selectedProfile?.name ?? ownResult.accountId}</Badge>
                  <Badge variant="outline">{ownResult.dateFrom} — {ownResult.dateTo}</Badge>
                  <Badge variant="outline">{ownResult.periodDays} дн.</Badge>
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <MetricCard icon={<FileJson className="h-4 w-4" />} label="Объявлений" value={formatNumber(ownResult.total.ads)} />
                <MetricCard icon={<MousePointerClick className="h-4 w-4" />} label="Просмотры" value={formatNumber(ownResult.total.views)} />
                <MetricCard icon={<Heart className="h-4 w-4" />} label="Добавили в избранное" value={formatNumber(ownResult.total.favorites)} />
                <MetricCard icon={<MessageCircle className="h-4 w-4" />} label="Написали / контакты" value={formatNumber(ownResult.total.contacts)} />
              </div>
            </section>

            <AiAnalysisReport key={`${ownResult.profileId}:${ownResult.dateFrom}:${ownResult.dateTo}`} analytics={ownResult} />

            <AdsRankingSection
              items={rankedItems}
              metric={rankingMetric}
              onMetricChange={setRankingMetric}
            />
          </>
        )}

        {activeTab === "market" && !marketResult && !marketLoading && (
          <div className="py-12 text-center text-muted-foreground">
            <Globe2 className="mx-auto mb-3 h-10 w-10 opacity-45" />
            <p className="text-sm font-semibold">Запустите общую проверку выдачи Avito</p>
          </div>
        )}

        {activeTab === "market" && marketResult && (
          <MarketResult result={marketResult} />
        )}
      </div>
    </div>
  );
}

function rankBy(items: OwnAnalyticsItem[], metric: RankingMetric) {
  return [...items].sort((a, b) => (b[metric] - a[metric]) || (b.views - a.views)).slice(0, 20);
}

async function waitForLocalAgent(timeoutMs = 15000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(LOCAL_AGENT_HEALTH_URL, { cache: "no-store" });
      if (response.ok) return true;
    } catch {
      // The local agent may still be starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 750));
  }
  return false;
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

function MarketResult({ result }: { result: ProbeResult }) {
  return (
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
              <ExternalItemLink key={item.url} href={item.url} title={item.id ? `ID ${item.id}` : item.url} />
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
  );
}

function AdsRankingSection({
  items,
  metric,
  onMetricChange,
}: {
  items: OwnAnalyticsItem[];
  metric: RankingMetric;
  onMetricChange: (metric: RankingMetric) => void;
}) {
  const metricOptions: Array<{ value: RankingMetric; label: string; icon: ReactNode }> = [
    { value: "views", label: "Просмотры", icon: <MousePointerClick className="h-4 w-4" /> },
    { value: "favorites", label: "Избранное", icon: <Heart className="h-4 w-4" /> },
    { value: "contacts", label: "Контакты", icon: <MessageCircle className="h-4 w-4" /> },
  ];

  return (
    <Card className="analytics-ranking-table overflow-hidden">
      <CardHeader className="gap-4 border-b p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
        <div>
          <CardTitle className="text-base">Рейтинг объявлений</CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">Сравните лидеров по ключевым показателям</p>
        </div>
        <div className="grid grid-cols-3 gap-1 rounded-lg bg-secondary/70 p-1">
          {metricOptions.map((option) => (
            <Button
              key={option.value}
              type="button"
              size="sm"
              variant={metric === option.value ? "default" : "ghost"}
              className="h-8 gap-1.5 px-2 sm:px-3"
              onClick={() => onMetricChange(option.value)}
            >
              {option.icon}
              <span className="hidden sm:inline">{option.label}</span>
            </Button>
          ))}
        </div>
      </CardHeader>
      {items.length === 0 ? (
        <CardContent className="py-14 text-center text-sm text-muted-foreground">Нет объявлений за период</CardContent>
      ) : (
        <>
          <div className="pc-only hidden overflow-x-auto">
            <table className="w-full table-fixed text-sm">
              <thead className="bg-secondary/35 text-left text-xs font-medium text-muted-foreground">
                <tr>
                  <th className="w-14 px-5 py-3">№</th>
                  <th className="px-3 py-3">Объявление</th>
                  <th className="w-32 px-3 py-3">Статус</th>
                  <th className={`w-28 px-3 py-3 text-right ${metric === "views" ? "text-primary" : ""}`}>Просмотры</th>
                  <th className={`w-28 px-3 py-3 text-right ${metric === "favorites" ? "text-primary" : ""}`}>Избранное</th>
                  <th className={`w-28 px-3 py-3 text-right ${metric === "contacts" ? "text-primary" : ""}`}>Контакты</th>
                  <th className="w-28 px-5 py-3 text-right">Конверсия</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/70">
                {items.map((item, index) => (
                  <tr key={item.itemId} className="transition-colors hover:bg-secondary/30">
                    <td className="px-5 py-3.5 font-semibold tabular-nums text-muted-foreground">{index + 1}</td>
                    <td className="px-3 py-3.5">
                      {item.url ? (
                        <a href={item.url} target="_blank" rel="noopener noreferrer" className="group block min-w-0">
                          <span className="flex items-center gap-1.5 font-medium group-hover:text-primary">
                            <span className="truncate">{item.title}</span>
                            <ExternalLink className="h-3.5 w-3.5 shrink-0 opacity-0 transition-opacity group-hover:opacity-100" />
                          </span>
                          <span className="mt-0.5 block text-xs text-muted-foreground">ID {item.itemId}</span>
                        </a>
                      ) : (
                        <div className="min-w-0">
                          <p className="truncate font-medium">{item.title}</p>
                          <p className="mt-0.5 text-xs text-muted-foreground">ID {item.itemId}</p>
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-3.5"><StatusBadge status={item.status} /></td>
                    <MetricCell value={item.views} active={metric === "views"} />
                    <MetricCell value={item.favorites} active={metric === "favorites"} />
                    <MetricCell value={item.contacts} active={metric === "contacts"} />
                    <td className="px-5 py-3.5 text-right font-medium tabular-nums">{formatConversion(item)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <CardContent className="mobile-only space-y-1 p-2">
            {items.map((item, index) => (
              <a
                key={item.itemId}
                href={item.url ?? "#"}
                target={item.url ? "_blank" : undefined}
                rel={item.url ? "noopener noreferrer" : undefined}
                className="flex items-center gap-3 rounded-lg p-2.5 hover:bg-secondary/60"
              >
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-secondary text-xs font-semibold tabular-nums text-muted-foreground">{index + 1}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{item.title}</span>
                  <span className="mt-0.5 block truncate text-xs text-muted-foreground">ID {item.itemId}{item.status ? ` · ${item.status}` : ""}</span>
                </span>
                <span className="shrink-0 text-right">
                  <span className="block font-semibold tabular-nums">{formatNumber(item[metric])}</span>
                  <span className="block text-[11px] text-muted-foreground">{metricOptions.find((option) => option.value === metric)?.label}</span>
                </span>
              </a>
            ))}
          </CardContent>
        </>
      )}
    </Card>
  );
}

function MetricCell({ value, active }: { value: number; active: boolean }) {
  return (
    <td className={`px-3 py-3.5 text-right font-semibold tabular-nums ${active ? "bg-primary/[0.06] text-primary" : ""}`}>
      {formatNumber(value)}
    </td>
  );
}

function StatusBadge({ status }: { status: string | null }) {
  return <Badge variant="outline" className="max-w-full truncate font-normal">{status || "—"}</Badge>;
}

function formatConversion(item: OwnAnalyticsItem): string {
  if (item.views <= 0) return "—";
  return `${((item.contacts / item.views) * 100).toFixed(1)}%`;
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("ru-RU").format(value);
}

function ExternalItemLink({ href, title }: { href: string; title: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-center justify-between gap-3 rounded-md px-2 py-2 text-sm hover:bg-secondary/70"
    >
      <span className="min-w-0 truncate">{title}</span>
      <ExternalLink className="h-4 w-4 shrink-0 text-muted-foreground" />
    </a>
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
  if (type === "search") return "выдача";
  return "неизвестно";
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} КБ`;
  return `${(bytes / 1024 / 1024).toFixed(1)} МБ`;
}
