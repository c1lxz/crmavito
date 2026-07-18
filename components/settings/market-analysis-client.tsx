"use client";

import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, BarChart3, CheckCircle2, ExternalLink, FileJson, Globe2, Heart, History, Loader2, MessageCircle, MousePointerClick, Search, ShieldAlert } from "lucide-react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "@/lib/hooks/use-toast";

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
  const [profilesOpen, setProfilesOpen] = useState(true);
  const [ownPeriodDays, setOwnPeriodDays] = useState(3);
  const [ownLoading, setOwnLoading] = useState(false);
  const [ownResult, setOwnResult] = useState<OwnAnalyticsResult | null>(null);

  const selectedProfile = credentialProfiles.find((profile) => profile.id === selectedProfileId) ?? null;
  const canSubmitMarket = category.trim().length > 0 && marketPeriodDays >= 1 && marketPeriodDays <= 30;
  const manualCredentialsComplete = Boolean(manualClientId.trim() && manualClientSecret.trim());
  const manualCredentialsPartial = Boolean(manualClientId.trim() || manualClientSecret.trim()) && !manualCredentialsComplete;
  const canSubmitOwn = (manualCredentialsComplete || Boolean(selectedProfileId)) && !manualCredentialsPartial && ownPeriodDays >= 1 && ownPeriodDays <= 270 && !ownLoading;

  const topViews = useMemo(() => rankBy(ownResult?.items ?? [], "views"), [ownResult]);
  const topFavorites = useMemo(() => rankBy(ownResult?.items ?? [], "favorites"), [ownResult]);
  const topContacts = useMemo(() => rankBy(ownResult?.items ?? [], "contacts"), [ownResult]);

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
    <div className="app-shell">
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
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <div className="w-full space-y-1 sm:w-40">
                <Label htmlFor="own-avito-period">Период, дней</Label>
                <Input
                  id="own-avito-period"
                  type="number"
                  min={1}
                  max={270}
                  value={ownPeriodDays}
                  onChange={(event) => setOwnPeriodDays(Number(event.target.value))}
                />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-xs text-muted-foreground">Профиль</p>
                <p className="truncate text-sm font-semibold">{selectedProfile?.name ?? "Выберите профиль Avito"}</p>
              </div>
              <div className="grid min-w-[280px] flex-1 gap-2 sm:grid-cols-2">
                <Input
                  placeholder="client_id вручную"
                  value={manualClientId}
                  onChange={(event) => setManualClientId(event.target.value)}
                />
                <Input
                  placeholder="client_secret вручную"
                  type="password"
                  value={manualClientSecret}
                  onChange={(event) => setManualClientSecret(event.target.value)}
                />
              </div>
              {credentialProfiles.length > 0 && (
                <Button size="sm" variant="outline" onClick={() => setProfilesOpen((value) => !value)}>
                  <History className="mr-1 h-4 w-4" />
                  Профили
                </Button>
              )}
              <Button size="sm" onClick={loadOwnAnalytics} disabled={!canSubmitOwn}>
                {ownLoading ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <BarChart3 className="mr-1 h-4 w-4" />}
                Загрузить
              </Button>
            </div>

            {profilesOpen && credentialProfiles.length > 0 && (
              <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                {credentialProfiles.map((profile) => (
                  <button
                    key={profile.id}
                    type="button"
                    onClick={() => setSelectedProfileId(profile.id)}
                    className={`rounded-md border p-3 text-left transition-colors hover:border-primary/30 hover:bg-accent/45 ${
                      selectedProfileId === profile.id ? "border-primary/40 bg-accent" : "border-border"
                    }`}
                  >
                    <p className="truncate text-sm font-semibold">{profile.name}</p>
                    <p className="mt-1 truncate text-xs text-muted-foreground">
                      {profile.accountId || profile.reportEmail || "Saved credentials"}
                    </p>
                  </button>
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="market" className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-[140px_1fr_auto] sm:items-end">
              <div className="space-y-1">
                <Label htmlFor="avito-period">Период, дней</Label>
                <Input
                  id="avito-period"
                  type="number"
                  min={1}
                  max={30}
                  value={marketPeriodDays}
                  onChange={(event) => setMarketPeriodDays(Number(event.target.value))}
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

      <div className="app-content space-y-3">
        {activeTab === "own" && !ownResult && !ownLoading && (
          <div className="py-12 text-center text-muted-foreground">
            <BarChart3 className="mx-auto mb-3 h-10 w-10 opacity-45" />
            <p className="text-sm font-semibold">Выберите профиль и загрузите API-аналитику объявлений</p>
          </div>
        )}

        {activeTab === "own" && ownResult && (
          <>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <MetricCard icon={<FileJson className="h-4 w-4" />} label="Объявлений" value={String(ownResult.total.ads)} />
              <MetricCard icon={<MousePointerClick className="h-4 w-4" />} label="Просмотры" value={String(ownResult.total.views)} />
              <MetricCard icon={<Heart className="h-4 w-4" />} label="Добавили в избранное" value={String(ownResult.total.favorites)} />
              <MetricCard icon={<MessageCircle className="h-4 w-4" />} label="Написали / контакты" value={String(ownResult.total.contacts)} />
            </div>

            <Card>
              <CardContent className="flex flex-wrap items-center gap-2 p-4 text-sm text-muted-foreground">
                <Badge variant="secondary">{selectedProfile?.name ?? ownResult.accountId}</Badge>
                <Badge variant="outline">{ownResult.dateFrom} - {ownResult.dateTo}</Badge>
                <Badge variant="outline">{ownResult.periodDays} дн.</Badge>
              </CardContent>
            </Card>

            <div className="grid gap-3 xl:grid-cols-3">
              <RankingCard title="Больше всего просмотров" icon={<MousePointerClick className="h-4 w-4" />} items={topViews} metric="views" metricLabel="просм." />
              <RankingCard title="Больше добавили в избранное" icon={<Heart className="h-4 w-4" />} items={topFavorites} metric="favorites" metricLabel="избр." />
              <RankingCard title="Больше написали" icon={<MessageCircle className="h-4 w-4" />} items={topContacts} metric="contacts" metricLabel="конт." />
            </div>
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

function rankBy(items: OwnAnalyticsItem[], metric: "views" | "favorites" | "contacts") {
  return [...items].sort((a, b) => (b[metric] - a[metric]) || (b.views - a.views)).slice(0, 10);
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

function RankingCard({
  title,
  icon,
  items,
  metric,
  metricLabel,
}: {
  title: string;
  icon: ReactNode;
  items: OwnAnalyticsItem[];
  metric: "views" | "favorites" | "contacts";
  metricLabel: string;
}) {
  return (
    <Card>
      <CardHeader className="p-4 pb-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          {icon}
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 p-4 pt-0">
        {items.length === 0 && (
          <p className="py-8 text-center text-sm text-muted-foreground">Нет объявлений за период</p>
        )}
        {items.map((item, index) => (
          <a
            key={item.itemId}
            href={item.url ?? "#"}
            target={item.url ? "_blank" : undefined}
            rel={item.url ? "noopener noreferrer" : undefined}
            className="flex items-center justify-between gap-3 rounded-md px-2 py-2 text-sm hover:bg-secondary/70"
          >
            <span className="min-w-0">
              <span className="block truncate font-medium">{index + 1}. {item.title}</span>
              <span className="block text-xs text-muted-foreground">ID {item.itemId}{item.status ? ` · ${item.status}` : ""}</span>
            </span>
            <span className="shrink-0 text-right">
              <span className="block text-sm font-semibold tabular-nums">{item[metric]}</span>
              <span className="block text-xs text-muted-foreground">{metricLabel}</span>
            </span>
          </a>
        ))}
      </CardContent>
    </Card>
  );
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
