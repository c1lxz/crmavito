"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { BrainCircuit, Check, ChevronRight, ImageIcon, Loader2, PencilLine, RefreshCw, Sparkles, ThumbsDown, WandSparkles } from "lucide-react";
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

type Decision = "pending" | "approved" | "rejected";

export function AiAnalysisReport({ analytics }: { analytics: AdsAnalysisInput }) {
  const [status, setStatus] = useState<AiStatus | null>(null);
  const [report, setReport] = useState<AdsAnalysisReport | null>(null);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [decisions, setDecisions] = useState<Record<string, Decision>>({});
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  useEffect(() => {
    void fetch("/api/avito/ads-analytics/ai-report", { cache: "no-store" })
      .then((response) => response.ok ? response.json() : null)
      .then((data) => { if (data) setStatus(data); })
      .catch(() => undefined);
  }, []);

  const approvedCount = useMemo(
    () => Object.values(decisions).filter((decision) => decision === "approved").length,
    [decisions],
  );

  async function generateReport() {
    setLoading(true);
    try {
      const response = await fetch("/api/avito/ads-analytics/ai-report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(analytics),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Не удалось получить отчёт Claude");
      setReport(data.report);
      setGeneratedAt(data.generatedAt);
      setDecisions(Object.fromEntries(data.report.actions.map((action: AdsAnalysisAction) => [action.id, "pending"])));
      setDrafts(Object.fromEntries(data.report.actions.map((action: AdsAnalysisAction) => [action.id, action.proposedValue ?? ""])));
      toast({ title: "AI-отчёт готов", description: `Claude подготовил действий: ${data.report.actions.length}` });
    } catch (error) {
      toast({ title: "Claude не ответил", description: error instanceof Error ? error.message : String(error), variant: "destructive" });
    } finally {
      setLoading(false);
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
              <h2 className="text-sm font-semibold">Умный анализ Claude</h2>
              <ProviderBadge configured={status?.claude.configured} label="Claude" />
              <ProviderBadge configured={status?.gemini.configured} label="Gemini Images" />
            </div>
            <p className="mt-1 max-w-2xl text-xs leading-5 text-muted-foreground">
              Ищет потери в воронке, предлагает точные изменения и отдаёт каждую правку на подтверждение.
            </p>
          </div>
        </div>
        <Button onClick={generateReport} disabled={loading || analytics.items.length === 0} size="sm">
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : report ? <RefreshCw className="h-4 w-4" /> : <WandSparkles className="h-4 w-4" />}
          {loading ? "Claude анализирует" : report ? "Обновить отчёт" : "Сформировать AI-отчёт"}
        </Button>
      </div>

      {!report ? (
        <CardContent className="p-4">
          <div className="grid gap-4 lg:grid-cols-[1fr_auto_1fr_auto_1fr] lg:items-center">
            <WorkflowStep icon={<Sparkles className="h-4 w-4" />} title="Находит проблему" text="Сравнивает просмотры, избранное и контакты по каждому объявлению." />
            <ChevronRight className="hidden h-4 w-4 text-muted-foreground/50 lg:block" />
            <WorkflowStep icon={<PencilLine className="h-4 w-4" />} title="Готовит правку" text="Пишет новый заголовок, описание или арт-дирекцию для изображения." />
            <ChevronRight className="hidden h-4 w-4 text-muted-foreground/50 lg:block" />
            <WorkflowStep icon={<Check className="h-4 w-4" />} title="Ждёт решения" text="Человек подтверждает, отклоняет или редактирует предложение." />
          </div>
          <div className="mt-4 flex items-center gap-3 rounded-md border border-dashed border-border bg-secondary/45 p-3">
            <ImageIcon className="h-5 w-5 shrink-0 text-primary" />
            <p className="text-xs leading-5 text-muted-foreground">
              Контент-машина подготовлена: Claude будет формировать дизайн-бриф, а Gemini — создавать только изображения футболок и лонгсливов.
            </p>
          </div>
        </CardContent>
      ) : (
        <CardContent className="p-0">
          <div className="grid gap-0 border-b sm:grid-cols-[120px_1fr]">
            <div className="flex items-center gap-3 bg-secondary/55 p-4 sm:flex-col sm:items-start sm:justify-center">
              <span className="text-3xl font-semibold tracking-tight">{report.healthScore}</span>
              <span className="text-xs font-medium text-muted-foreground">здоровье / 100</span>
            </div>
            <div className="space-y-2 p-4">
              <p className="text-sm font-semibold leading-6">{report.executiveSummary}</p>
              <p className="text-xs leading-5 text-muted-foreground"><span className="font-semibold text-foreground">Главная возможность:</span> {report.opportunity}</p>
              {generatedAt && <p className="text-[11px] text-muted-foreground">Отчёт от {new Date(generatedAt).toLocaleString("ru-RU")}</p>}
            </div>
          </div>

          <div className="divide-y">
            {report.actions.map((action) => (
              <ActionRow
                key={action.id}
                action={action}
                decision={decisions[action.id] ?? "pending"}
                draft={drafts[action.id] ?? ""}
                onDecision={(decision) => setDecisions((current) => ({ ...current, [action.id]: decision }))}
                onDraft={(value) => setDrafts((current) => ({ ...current, [action.id]: value }))}
              />
            ))}
          </div>

          <div className="flex flex-col gap-3 bg-secondary/35 p-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs text-muted-foreground">
              Одобрено: <span className="font-semibold text-foreground">{approvedCount}</span> · Автоприменение подключается отдельным безопасным шагом через Avito.
            </p>
            <Button size="sm" disabled title="Станет доступно после подключения обновления объявлений Avito">
              Применить одобренные
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

function WorkflowStep({ icon, title, text }: { icon: ReactNode; title: string; text: string }) {
  return (
    <div className="flex gap-3">
      <div className="icon-tile h-8 w-8 bg-secondary">{icon}</div>
      <div>
        <p className="text-xs font-semibold">{title}</p>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">{text}</p>
      </div>
    </div>
  );
}

function ActionRow({
  action,
  decision,
  draft,
  onDecision,
  onDraft,
}: {
  action: AdsAnalysisAction;
  decision: Decision;
  draft: string;
  onDecision: (decision: Decision) => void;
  onDraft: (value: string) => void;
}) {
  return (
    <div className={cn("p-4 transition-colors", decision === "approved" && "bg-emerald-50/60 dark:bg-emerald-950/15", decision === "rejected" && "bg-secondary/45 opacity-70")}>
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={action.priority === "high" ? "destructive" : action.priority === "medium" ? "warning" : "secondary"}>
              {action.priority === "high" ? "Высокий приоритет" : action.priority === "medium" ? "Средний приоритет" : "Низкий приоритет"}
            </Badge>
            <Badge variant="outline">{fieldLabel(action.field)}</Badge>
            {action.applyMode === "content_machine" && <Badge variant="secondary">Gemini Images</Badge>}
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
          <Button size="sm" variant={decision === "approved" ? "default" : "outline"} onClick={() => onDecision(decision === "approved" ? "pending" : "approved")}>
            <Check className="h-4 w-4" /> Одобрить
          </Button>
          <Button size="sm" variant={decision === "rejected" ? "secondary" : "ghost"} onClick={() => onDecision(decision === "rejected" ? "pending" : "rejected")}>
            <ThumbsDown className="h-4 w-4" /> Отклонить
          </Button>
        </div>
      </div>
    </div>
  );
}

function fieldLabel(field: AdsAnalysisAction["field"]) {
  return ({ title: "Заголовок", description: "Описание", photos: "Фотографии", price: "Цена", promotion: "Продвижение", other: "Другое" } as const)[field];
}
