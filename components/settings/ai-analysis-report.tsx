"use client";

import { useEffect, useMemo, useState } from "react";
import { BrainCircuit, Check, Copy, ExternalLink, ListChecks, Loader2, RefreshCw, ThumbsDown, WandSparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/lib/hooks/use-toast";
import type { AdsAnalysisAction, AdsAnalysisInput, AdsAnalysisReport } from "@/lib/ai/ads-analysis";
import { cn } from "@/lib/utils";

type AiStatus = {
  claude: { configured: boolean; model: string };
  gemini: { configured: boolean; model: string };
};

type Decision = "pending" | "approved" | "rejected" | "queued";

function parseReportResponse(response: Response, raw: string) {
  if (!raw.trim()) {
    throw new Error("Сервис анализа вернул пустой ответ. Попробуйте ещё раз.");
  }
  try {
    return JSON.parse(raw);
  } catch {
    if ([502, 503, 504].includes(response.status) || /^\s*</.test(raw)) {
      throw new Error("Customix не успел завершить отчёт. Повторите запрос — загружать аналитику заново не нужно.");
    }
    throw new Error("Сервис анализа вернул некорректный ответ. Попробуйте ещё раз.");
  }
}

export function AiAnalysisReport({ analytics }: { analytics: AdsAnalysisInput }) {
  const [status, setStatus] = useState<AiStatus | null>(null);
  const [report, setReport] = useState<AdsAnalysisReport | null>(null);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [requestError, setRequestError] = useState<string | null>(null);
  const [decisions, setDecisions] = useState<Record<string, Decision>>({});
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [handingOff, setHandingOff] = useState(false);

  useEffect(() => {
    void fetch("/api/avito/ads-analytics/ai-report", { cache: "no-store" })
      .then((response) => response.ok ? response.json() : null)
      .then((data) => { if (data) setStatus(data); })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!loading) return;
    setElapsedSeconds(0);
    const timer = window.setInterval(() => setElapsedSeconds((value) => value + 1), 1000);
    return () => window.clearInterval(timer);
  }, [loading]);

  const approvedCount = useMemo(
    () => Object.values(decisions).filter((decision) => decision === "approved").length,
    [decisions],
  );
  const queuedCount = useMemo(
    () => Object.values(decisions).filter((decision) => decision === "queued").length,
    [decisions],
  );

  async function generateReport() {
    setLoading(true);
    setRequestError(null);
    try {
      const response = await fetch("/api/avito/ads-analytics/ai-report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(analytics),
      });
      const raw = await response.text();
      const data = parseReportResponse(response, raw);
      if (!response.ok) throw new Error(data.error ?? "Не удалось получить отчёт Claude");
      setReport(data.report);
      setGeneratedAt(data.generatedAt);
      setDecisions(Object.fromEntries(data.report.actions.map((action: AdsAnalysisAction) => [action.id, "pending"])));
      setDrafts(Object.fromEntries(data.report.actions.map((action: AdsAnalysisAction) => [action.id, action.proposedValue ?? ""])));
      toast({
        title: data.warning ? "Отчёт по данным готов" : "AI-отчёт готов",
        description: data.warning ?? `Claude подготовил действий: ${data.report.actions.length}`,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setRequestError(message);
      toast({ title: "Claude не ответил", description: message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  async function handOffApproved() {
    if (!report || !generatedAt) return;
    const selected = report.actions
      .filter((action) => decisions[action.id] === "approved")
      .map((action) => ({
        action: { ...action, proposedValue: drafts[action.id]?.trim() || action.proposedValue },
        listingUrl: analytics.items.find((item) => item.itemId === action.itemId)?.url ?? null,
      }));
    if (!selected.length) return;

    setHandingOff(true);
    try {
      const response = await fetch("/api/avito/ads-analytics/actions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ generatedAt, actions: selected }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error ?? "Не удалось создать задачи");
      setDecisions((current) => ({
        ...current,
        ...Object.fromEntries(selected.map(({ action }) => [action.id, "queued"])),
      }));
      toast({
        title: "Передано в работу",
        description: `Создано задач: ${data.created}${data.skipped ? ` · уже существовало: ${data.skipped}` : ""}`,
      });
    } catch (error) {
      toast({
        title: "Не удалось передать задачи",
        description: error instanceof Error ? error.message : String(error),
        variant: "destructive",
      });
    } finally {
      setHandingOff(false);
    }
  }

  return (
    <Card className="overflow-hidden border-primary/20">
      <div className="flex flex-col gap-4 border-b bg-accent/40 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <div className="icon-tile border-primary/20 bg-primary text-primary-foreground">
            <BrainCircuit className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-sm font-semibold">Анализ и план роста</h2>
              <ProviderBadge configured={status?.claude.configured} label="Claude" />
            </div>
            <p className="mt-1 max-w-2xl text-xs leading-5 text-muted-foreground">
              Сравнивает объявления по воронке и превращает выводы в конкретные задачи.
            </p>
          </div>
        </div>
        <Button type="button" onClick={() => void generateReport()} disabled={loading || analytics.items.length === 0} size="sm">
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : report ? <RefreshCw className="h-4 w-4" /> : <WandSparkles className="h-4 w-4" />}
          {loading ? "Claude анализирует" : report ? "Обновить отчёт" : "Сформировать AI-отчёт"}
        </Button>
      </div>

      {!report ? (
        <CardContent className="p-4">
          {loading && (
            <div role="status" className="mb-4 flex items-center gap-3 rounded-lg border border-primary/25 bg-primary/[0.06] p-3">
              <Loader2 className="h-5 w-5 shrink-0 animate-spin text-primary" />
              <div>
                <p className="text-sm font-semibold">Claude анализирует {analytics.items.length} объявлений</p>
                <p className="mt-0.5 text-xs text-muted-foreground">Запрос выполняется · {elapsedSeconds} сек. При перегрузке CRM повторит его автоматически.</p>
              </div>
            </div>
          )}
          {requestError && !loading && (
            <div role="alert" className="mb-4 rounded-lg border border-destructive/30 bg-destructive/10 p-3">
              <p className="text-sm font-semibold text-destructive">Не удалось сформировать отчёт</p>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">{requestError}</p>
              <Button type="button" variant="outline" size="sm" className="mt-3" onClick={() => void generateReport()}>
                <RefreshCw className="h-4 w-4" />Повторить
              </Button>
            </div>
          )}
          {!loading && !requestError && (
            <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
              Отчёт покажет ключевые цифры, главные закономерности и короткий приоритетный план без повторяющихся советов.
            </p>
          )}
        </CardContent>
      ) : (
        <CardContent className="p-0">
          <div className="border-b">
            <div className="space-y-2 p-4">
              <p className="text-sm font-semibold leading-6">{report.executiveSummary}</p>
              <p className="text-xs leading-5 text-muted-foreground"><span className="font-semibold text-foreground">Главная возможность:</span> {report.opportunity}</p>
              {generatedAt && <p className="text-[11px] text-muted-foreground">Отчёт от {new Date(generatedAt).toLocaleString("ru-RU")}</p>}
            </div>
          </div>

          {report.accountMetrics.length > 0 && (
            <div className="grid gap-px border-b bg-border sm:grid-cols-2 xl:grid-cols-3">
              {report.accountMetrics.slice(0, 6).map((metric, index) => (
                <div key={`${metric.label}-${index}`} className="bg-background p-4">
                  <p className="text-xs font-medium text-muted-foreground">{metric.label}</p>
                  <p className="mt-1 text-xl font-semibold tracking-tight">{metric.value}</p>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">{metric.context}</p>
                </div>
              ))}
            </div>
          )}

          {report.portfolioInsights.length > 0 && (
            <div className="border-b p-4">
              <p className="mb-3 text-sm font-semibold">Выводы по аккаунту и ассортименту</p>
              <div className="divide-y rounded-md border">
                {report.portfolioInsights.slice(0, 5).map((insight, index) => (
                  <div key={`${insight.title}-${index}`} className="p-3">
                    <div className="flex flex-col gap-1 sm:flex-row sm:gap-3">
                      <p className="w-full shrink-0 text-sm font-semibold sm:w-48">{insight.title}</p>
                      <div>
                        <p className="text-xs leading-5 text-muted-foreground">{insight.finding}</p>
                        <p className="mt-1 text-xs leading-5"><span className="font-semibold">Решение:</span> {insight.recommendation}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="flex items-center justify-between border-b px-4 py-3">
            <div>
              <p className="text-sm font-semibold">Приоритетный план</p>
              <p className="text-xs text-muted-foreground">Выберите нужное и передайте в задачи CRM.</p>
            </div>
            <Badge variant="secondary">{report.actions.length}</Badge>
          </div>

          <div className="divide-y">
            {report.actions.map((action) => (
              <ActionRow
                key={action.id}
                action={action}
                decision={decisions[action.id] ?? "pending"}
                draft={drafts[action.id] ?? ""}
                listingUrl={analytics.items.find((item) => item.itemId === action.itemId)?.url ?? null}
                onDecision={(decision) => setDecisions((current) => ({ ...current, [action.id]: decision }))}
                onDraft={(value) => setDrafts((current) => ({ ...current, [action.id]: value }))}
              />
            ))}
          </div>

          <div className="flex flex-col gap-3 bg-secondary/35 p-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs text-muted-foreground">
              В плане: <span className="font-semibold text-foreground">{approvedCount}</span>
              {queuedCount > 0 && <> · Создано задач: <span className="font-semibold text-foreground">{queuedCount}</span></>}
              {" "}· Контент Avito меняется после выполнения задачи.
            </p>
            <Button size="sm" disabled={approvedCount === 0 || handingOff} onClick={() => void handOffApproved()}>
              {handingOff ? <Loader2 className="h-4 w-4 animate-spin" /> : <ListChecks className="h-4 w-4" />}
              {handingOff ? "Создаю задачи" : `Передать в задачи${approvedCount ? ` (${approvedCount})` : ""}`}
            </Button>
          </div>
        </CardContent>
      )}
    </Card>
  );
}

function ProviderBadge({ configured, label }: { configured: boolean | undefined; label: string }) {
  return (
    <Badge variant={configured ? "success" : "outline"} className="font-medium">
      {configured ? "готов" : "нужен ключ"} · {label}
    </Badge>
  );
}

function ActionRow({
  action,
  decision,
  draft,
  listingUrl,
  onDecision,
  onDraft,
}: {
  action: AdsAnalysisAction;
  decision: Decision;
  draft: string;
  listingUrl: string | null;
  onDecision: (decision: Decision) => void;
  onDraft: (value: string) => void;
}) {
  return (
    <div className={cn("p-4 transition-colors", decision === "approved" && "bg-emerald-50/60 dark:bg-emerald-950/15", decision === "queued" && "bg-primary/[0.04]", decision === "rejected" && "bg-secondary/45 opacity-70")}>
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={action.priority === "high" ? "destructive" : action.priority === "medium" ? "warning" : "secondary"}>
              {action.priority === "high" ? "Высокий приоритет" : action.priority === "medium" ? "Средний приоритет" : "Низкий приоритет"}
            </Badge>
            <Badge variant="outline">{fieldLabel(action.field)}</Badge>
            {action.applyMode === "content_machine" && <Badge variant="secondary">Gemini Images</Badge>}
            {decision === "queued" && <Badge variant="success">Задача создана</Badge>}
          </div>
          <p className="mt-2 text-sm font-semibold">{action.title}</p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">{action.diagnosis}</p>
          <p className="mt-2 text-xs"><span className="font-semibold">Ожидаемый эффект:</span> {action.expectedImpact}</p>
          {action.proposedValue !== null && (
            <div className="mt-3">
              <p className="mb-1.5 text-xs font-semibold">Предлагаемая правка</p>
              <Textarea value={draft} onChange={(event) => onDraft(event.target.value)} className="min-h-[76px] bg-background" />
            </div>
          )}
        </div>
        <div className="flex shrink-0 gap-2 lg:flex-col">
          <Button size="sm" variant={decision === "approved" ? "default" : "outline"} disabled={decision === "queued"} onClick={() => onDecision(decision === "approved" ? "pending" : "approved")}>
            <Check className="h-4 w-4" /> {decision === "queued" ? "В работе" : "В план"}
          </Button>
          <Button size="sm" variant={decision === "rejected" ? "secondary" : "ghost"} disabled={decision === "queued"} onClick={() => onDecision(decision === "rejected" ? "pending" : "rejected")}>
            <ThumbsDown className="h-4 w-4" /> Отклонить
          </Button>
          {draft && (
            <Button size="sm" variant="ghost" onClick={() => void navigator.clipboard.writeText(draft).then(() => toast({ title: "Правка скопирована" }))}>
              <Copy className="h-4 w-4" /> Копировать
            </Button>
          )}
          {listingUrl && (
            <Button size="sm" variant="ghost" asChild>
              <a href={listingUrl} target="_blank" rel="noreferrer"><ExternalLink className="h-4 w-4" /> Открыть</a>
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function fieldLabel(field: AdsAnalysisAction["field"]) {
  return ({ title: "Заголовок", description: "Описание", photos: "Фотографии", video: "Flow-видео", price: "Цена", promotion: "Продвижение", duplicate: "Дубли", assortment: "Ассортимент", other: "Другое" } as const)[field];
}
