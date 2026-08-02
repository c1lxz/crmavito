"use client";

import { useState } from "react";
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Clipboard,
  Download,
  Info,
  Loader2,
  RefreshCw,
  ShieldAlert,
  XCircle,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { toast } from "@/lib/hooks/use-toast";

type Background = {
  slot: string;
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
  productName: string;
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
} | null;

type CheckStatus = "pass" | "warning" | "fail" | "info";
type DiagnosticCheck = {
  id: string;
  group: "Система" | "Flow" | "Фоны" | "Исходники" | "Результаты";
  title: string;
  detail: string;
  status: CheckStatus;
};

type DiagnosticReport = {
  reportId: string;
  createdAt: string;
  pageUrl: string;
  userAgent: string;
  viewport: string;
  online: boolean;
  jobId: string | null;
  incidents: DiagnosticIncident[];
  checks: DiagnosticCheck[];
};

export type DiagnosticIncident = {
  id: string;
  occurredAt: string;
  action: string;
  cause: string;
  resolution: string;
  technical: string;
};

type Props = {
  backgrounds: Background[];
  products: ProductPhoto[];
  agentStatus: FlowAgentStatus | null;
  job: FlowJob;
  incidents: DiagnosticIncident[];
  onClearIncidents: () => void;
};

const groupOrder: DiagnosticCheck["group"][] = ["Система", "Flow", "Фоны", "Исходники", "Результаты"];

export function ContentMachineDiagnostics({ backgrounds, products, agentStatus, job, incidents, onClearIncidents }: Props) {
  const [running, setRunning] = useState(false);
  const [report, setReport] = useState<DiagnosticReport | null>(null);

  async function runDiagnostics() {
    setRunning(true);
    const checks: DiagnosticCheck[] = [];
    const add = (check: DiagnosticCheck) => checks.push(check);

    try {
      add({
        id: "browser-online",
        group: "Система",
        title: "Подключение браузера",
        detail: navigator.onLine ? "Браузер сообщает, что сеть доступна." : "Браузер работает без сети.",
        status: navigator.onLine ? "pass" : "fail",
      });

      try {
        const key = `content-machine-diagnostic-${Date.now()}`;
        window.localStorage.setItem(key, "ok");
        window.localStorage.removeItem(key);
        add({ id: "local-storage", group: "Система", title: "Локальное хранилище", detail: "Сохранение номера последней задачи работает.", status: "pass" });
      } catch (error) {
        add({ id: "local-storage", group: "Система", title: "Локальное хранилище", detail: errorMessage(error), status: "fail" });
      }

      await checkEndpoint("/api/ai/content-machine/backgrounds", "API контент-машины", "Система", add);
      await checkEndpoint("/api/ai/content-machine/flow-agent/status", "API статуса Flow", "Flow", add);

      if (agentStatus?.online && agentStatus.state === "ready") {
        add({
          id: "flow-agent",
          group: "Flow",
          title: "Локальный Flow-агент",
          detail: `Онлайн, параллельных потоков: ${agentStatus.concurrency}. ${agentStatus.message || ""}`.trim(),
          status: "pass",
        });
      } else {
        add({
          id: "flow-agent",
          group: "Flow",
          title: "Локальный Flow-агент",
          detail: agentStatus?.message || "Агент не прислал актуальный статус.",
          status: "fail",
        });
      }

      if (backgrounds.length !== 4) {
        add({ id: "background-count", group: "Фоны", title: "Количество эталонных фонов", detail: `Получено ${backgrounds.length}, требуется ровно 4.`, status: "fail" });
      } else {
        add({ id: "background-count", group: "Фоны", title: "Количество эталонных фонов", detail: "Все 4 слота доступны.", status: "pass" });
      }

      for (const background of backgrounds) {
        if (!background.url) {
          add({ id: `background-${background.slot}`, group: "Фоны", title: `Фон ${background.slot}`, detail: "Файл не загружен.", status: "fail" });
          continue;
        }
        add(await inspectImage({
          id: `background-${background.slot}`,
          group: "Фоны",
          title: `Фон ${background.slot}: ${background.fileName || "без имени"}`,
          url: background.url,
          fileSize: background.size,
          expected: "reference",
        }));
      }

      if (products.length === 0) {
        add({ id: "products-empty", group: "Исходники", title: "Исходные фото", detail: "Фото пока не добавлены — их качество не проверялось.", status: "info" });
      }
      for (const [index, product] of products.entries()) {
        add(await inspectImage({
          id: `product-${product.id}`,
          group: "Исходники",
          title: `Фото ${index + 1}: ${product.file.name}`,
          url: product.previewUrl,
          fileSize: product.file.size,
          expected: "source",
        }));
      }

      if (!job) {
        add({ id: "job-empty", group: "Результаты", title: "Последняя задача", detail: "Задача ещё не запускалась в этом браузере.", status: "info" });
      } else {
        const resultStatus: CheckStatus =
          job.status === "failed" ? "fail" :
            job.status === "partial" ? "warning" :
              job.status === "ready" && job.results.length === job.expectedResults ? "pass" : "info";
        add({
          id: "job-status",
          group: "Результаты",
          title: `Задача ${job.id}`,
          detail: `Статус: ${job.status}; файлов: ${job.results.length} из ${job.expectedResults}; ошибок: ${job.failedResults || 0}.${job.error ? ` ${job.error}` : ""}`,
          status: resultStatus,
        });
        for (const [index, result] of job.results.entries()) {
          add(await inspectImage({
            id: `result-${result.id}`,
            group: "Результаты",
            title: `Результат ${index + 1}: ${result.fileName}`,
            url: result.url,
            fileSize: result.size,
            expected: job.imageSize === "4K" ? "result-4k" : "result-2k",
          }));
        }
      }
    } catch (error) {
      add({ id: "unexpected", group: "Система", title: "Непредвиденная ошибка диагностики", detail: errorMessage(error), status: "fail" });
    }

    const nextReport: DiagnosticReport = {
      reportId: `CM-DIAG-${new Date().toISOString().replace(/\D/g, "").slice(0, 14)}`,
      createdAt: new Date().toISOString(),
      pageUrl: window.location.href,
      userAgent: navigator.userAgent,
      viewport: `${window.innerWidth}×${window.innerHeight} @${window.devicePixelRatio}x`,
      online: navigator.onLine,
      jobId: job?.id || null,
      incidents,
      checks,
    };
    setReport(nextReport);
    setRunning(false);
    window.requestAnimationFrame(() => document.getElementById("content-machine-diagnostic-report")?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }

  async function copyReport() {
    if (!report) return;
    try {
      await copyText(formatReport(report));
      toast({ title: "Диагностика скопирована", description: "Вставьте текст в сообщение вместе со скриншотом." });
    } catch (error) {
      toast({ title: "Не удалось скопировать", description: errorMessage(error), variant: "destructive" });
    }
  }

  function downloadReport() {
    if (!report) return;
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${report.reportId}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  async function copyLastIncident() {
    const incident = incidents[0];
    if (!incident) return;
    try {
      await copyText(formatIncident(incident));
      toast({ title: "Ошибка скопирована", description: "Отправьте этот текст вместе со скриншотом." });
    } catch (error) {
      toast({ title: "Не удалось скопировать", description: errorMessage(error), variant: "destructive" });
    }
  }

  const failures = report?.checks.filter((item) => item.status === "fail").length || 0;
  const warnings = report?.checks.filter((item) => item.status === "warning").length || 0;
  const passes = report?.checks.filter((item) => item.status === "pass").length || 0;
  const overall = failures > 0 ? "fail" : warnings > 0 ? "warning" : report ? "pass" : "info";

  return (
    <section id="content-machine-diagnostics" className="scroll-mt-24">
      <Card className="overflow-hidden border-primary/20">
        <CardContent className="p-0">
          <div className="flex flex-col gap-4 bg-primary/[0.035] p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
            <div className="flex items-start gap-3">
              <span className="icon-tile h-10 w-10 shrink-0"><ShieldAlert className="h-5 w-5 text-primary" /></span>
              <div>
                <h2 className="text-base font-semibold">Полная диагностика</h2>
                <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
                  Автоматически объясняет ошибки во время работы. Ручная проверка дополнительно проверяет связь, Flow и все изображения.
                </p>
              </div>
            </div>
            <Button onClick={() => void runDiagnostics()} disabled={running} className="min-h-11 shrink-0">
              {running ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
              {running ? "Проверяю…" : report ? "Проверить снова" : "Запустить диагностику"}
            </Button>
          </div>

          <div className="border-t p-4 sm:p-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-semibold">Журнал ошибок при работе</h3>
                  <Badge variant={incidents.length ? "destructive" : "success"}>
                    {incidents.length ? `${incidents.length} событий` : "Ошибок нет"}
                  </Badge>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  Ошибки загрузки, запуска Flow, обновления задачи и отображения фото появляются здесь автоматически.
                </p>
              </div>
              {incidents.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" size="sm" className="min-h-11" onClick={() => void copyLastIncident()}>
                    <Clipboard className="mr-1.5 h-4 w-4" />Скопировать последнюю
                  </Button>
                  <Button variant="ghost" size="sm" className="min-h-11" onClick={onClearIncidents}>Очистить</Button>
                </div>
              )}
            </div>

            {incidents.length === 0 ? (
              <div className="mt-4 flex items-start gap-3 rounded-lg border border-success/20 bg-success/[0.04] p-4">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" />
                <p className="text-sm text-muted-foreground">Работайте как обычно. Если что-то сломается, здесь появятся причина, решение и технические детали.</p>
              </div>
            ) : (
              <div className="mt-4 space-y-3">
                {incidents.slice(0, 10).map((incident) => (
                  <div key={incident.id} className="rounded-lg border border-destructive/25 bg-destructive/[0.035] p-4">
                    <div className="flex items-start gap-3">
                      <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          <p className="text-sm font-semibold">{incident.action}</p>
                          <span className="font-mono text-[11px] text-muted-foreground">
                            {new Date(incident.occurredAt).toLocaleString("ru-RU")}
                          </span>
                        </div>
                        <div className="mt-3 grid gap-3 lg:grid-cols-2">
                          <div>
                            <p className="text-[11px] font-semibold uppercase tracking-wide text-destructive">Почему</p>
                            <p className="mt-1 text-sm">{incident.cause}</p>
                          </div>
                          <div>
                            <p className="text-[11px] font-semibold uppercase tracking-wide text-success">Что делать</p>
                            <p className="mt-1 text-sm">{incident.resolution}</p>
                          </div>
                        </div>
                        <details className="mt-3">
                          <summary className="cursor-pointer text-xs font-medium text-muted-foreground">Технические детали</summary>
                          <p className="mt-2 break-words rounded-md bg-background/70 p-3 font-mono text-[11px] text-muted-foreground">{incident.technical}</p>
                        </details>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {report && (
            <div id="content-machine-diagnostic-report" className="scroll-mt-24 border-t p-4 sm:p-5">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusIcon status={overall} />
                    <h3 className="font-semibold">
                      {overall === "pass" ? "Система готова к работе" : overall === "warning" ? "Есть замечания по качеству" : "Обнаружены ошибки"}
                    </h3>
                    <Badge variant={overall === "pass" ? "success" : overall === "warning" ? "warning" : "destructive"}>
                      {failures} ошибок · {warnings} замечаний · {passes} проверок OK
                    </Badge>
                  </div>
                  <p className="mt-1 font-mono text-xs text-muted-foreground">
                    {report.reportId} · {new Date(report.createdAt).toLocaleString("ru-RU")} · {report.viewport}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" size="sm" className="min-h-11" onClick={() => void copyReport()}><Clipboard className="mr-1.5 h-4 w-4" />Копировать</Button>
                  <Button variant="outline" size="sm" className="min-h-11" onClick={downloadReport}><Download className="mr-1.5 h-4 w-4" />Скачать JSON</Button>
                </div>
              </div>

              <div className="mt-5 grid gap-4 xl:grid-cols-2">
                {groupOrder.map((group) => {
                  const groupChecks = report.checks.filter((item) => item.group === group);
                  if (groupChecks.length === 0) return null;
                  return (
                    <div key={group} className="rounded-lg border bg-card">
                      <div className="border-b px-4 py-3">
                        <h4 className="text-sm font-semibold">{group}</h4>
                      </div>
                      <div className="divide-y">
                        {groupChecks.map((check) => (
                          <div key={check.id} className="flex items-start gap-3 px-4 py-3">
                            <StatusIcon status={check.status} />
                            <div className="min-w-0">
                              <p className="text-sm font-medium">{check.title}</p>
                              <p className="mt-0.5 break-words text-xs leading-relaxed text-muted-foreground">{check.detail}</p>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </section>
  );
}

function StatusIcon({ status }: { status: CheckStatus }) {
  if (status === "pass") return <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" />;
  if (status === "warning") return <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />;
  if (status === "fail") return <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />;
  return <Info className="mt-0.5 h-4 w-4 shrink-0 text-info" />;
}

async function checkEndpoint(
  url: string,
  title: string,
  group: DiagnosticCheck["group"],
  add: (check: DiagnosticCheck) => void,
) {
  const startedAt = performance.now();
  try {
    const response = await fetch(url, { cache: "no-store" });
    const duration = Math.round(performance.now() - startedAt);
    add({
      id: `endpoint-${url}`,
      group,
      title,
      detail: response.ok ? `Ответ ${response.status} за ${duration} мс.` : `HTTP ${response.status} за ${duration} мс.`,
      status: response.ok ? (duration > 3_000 ? "warning" : "pass") : "fail",
    });
  } catch (error) {
    add({ id: `endpoint-${url}`, group, title, detail: errorMessage(error), status: "fail" });
  }
}

async function inspectImage(input: {
  id: string;
  group: DiagnosticCheck["group"];
  title: string;
  url: string;
  fileSize: number;
  expected: "reference" | "source" | "result-2k" | "result-4k";
}): Promise<DiagnosticCheck> {
  try {
    const image = await loadImage(input.url);
    const pixels = samplePixels(image);
    const minEdge = Math.min(image.naturalWidth, image.naturalHeight);
    const maxEdge = Math.max(image.naturalWidth, image.naturalHeight);
    const requiredResultEdge = input.expected === "result-4k" ? 3900 : input.expected === "result-2k" ? 1900 : 0;
    const warnings: string[] = [];

    if (requiredResultEdge && maxEdge < requiredResultEdge) warnings.push(`длинная сторона ниже ${requiredResultEdge}px`);
    if (!requiredResultEdge && minEdge < 900) warnings.push("малая сторона ниже 900px");
    if (pixels.average < 48) warnings.push("кадр слишком тёмный");
    if (pixels.average > 220) warnings.push("кадр пересвечен");
    if (pixels.darkShare > 0.58) warnings.push("более половины кадра в глубоких тенях");
    if (pixels.lightShare > 0.58) warnings.push("более половины кадра почти белое");
    if (pixels.sharpness < 28) warnings.push("возможна недостаточная резкость");
    if (input.fileSize > 12 * 1024 * 1024) warnings.push("файл тяжелее 12 МБ");
    if (input.fileSize <= 0) warnings.push("сервер сообщил нулевой размер файла");

    const metrics = `${image.naturalWidth}×${image.naturalHeight}, ${formatBytes(input.fileSize)}, яркость ${Math.round(pixels.average)}/255, резкость ${Math.round(pixels.sharpness)}`;
    return {
      id: input.id,
      group: input.group,
      title: input.title,
      detail: warnings.length ? `${metrics}. Замечания: ${warnings.join("; ")}.` : `${metrics}. Файл открывается, базовые показатели качества в норме.`,
      status: warnings.length ? "warning" : "pass",
    };
  } catch (error) {
    return { id: input.id, group: input.group, title: input.title, detail: `Изображение не открылось: ${errorMessage(error)}`, status: "fail" };
  }
}

function loadImage(url: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("ошибка загрузки или повреждённый файл"));
    image.src = url.startsWith("blob:") || url.startsWith("data:")
      ? url
      : `${url}${url.includes("?") ? "&" : "?"}diagnostic=${Date.now()}`;
  });
}

function samplePixels(image: HTMLImageElement) {
  const canvas = document.createElement("canvas");
  const width = Math.min(256, image.naturalWidth);
  const height = Math.max(1, Math.round(width * image.naturalHeight / image.naturalWidth));
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("Canvas недоступен");
  context.drawImage(image, 0, 0, width, height);
  const data = context.getImageData(0, 0, width, height).data;
  const gray = new Float32Array(width * height);
  let sum = 0;
  let dark = 0;
  let light = 0;
  for (let index = 0, pixel = 0; index < data.length; index += 4, pixel += 1) {
    const value = data[index] * 0.2126 + data[index + 1] * 0.7152 + data[index + 2] * 0.0722;
    gray[pixel] = value;
    sum += value;
    if (value < 32) dark += 1;
    if (value > 242) light += 1;
  }
  let edgeSum = 0;
  let edgeSquaredSum = 0;
  let edgeCount = 0;
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const index = y * width + x;
      const edge = 4 * gray[index] - gray[index - 1] - gray[index + 1] - gray[index - width] - gray[index + width];
      edgeSum += edge;
      edgeSquaredSum += edge * edge;
      edgeCount += 1;
    }
  }
  const edgeMean = edgeCount ? edgeSum / edgeCount : 0;
  return {
    average: sum / gray.length,
    darkShare: dark / gray.length,
    lightShare: light / gray.length,
    sharpness: edgeCount ? Math.max(0, edgeSquaredSum / edgeCount - edgeMean * edgeMean) : 0,
  };
}

function formatReport(report: DiagnosticReport) {
  const lines = [
    `Диагностика Контент-машины ${report.reportId}`,
    `Время: ${new Date(report.createdAt).toLocaleString("ru-RU")}`,
    `Экран: ${report.viewport}`,
    `Задача: ${report.jobId || "нет"}`,
    `Браузер: ${report.userAgent}`,
    "",
  ];
  if (report.incidents.length) {
    lines.push("ОШИБКИ ВО ВРЕМЯ РАБОТЫ:");
    report.incidents.forEach((incident) => lines.push(formatIncident(incident), ""));
  }
  for (const check of report.checks) {
    const marker = check.status === "pass" ? "OK" : check.status === "warning" ? "ВНИМАНИЕ" : check.status === "fail" ? "ОШИБКА" : "ИНФО";
    lines.push(`[${marker}] ${check.group} — ${check.title}: ${check.detail}`);
  }
  return lines.join("\n");
}

function formatIncident(incident: DiagnosticIncident) {
  return [
    `Ошибка: ${incident.action}`,
    `Время: ${new Date(incident.occurredAt).toLocaleString("ru-RU")}`,
    `Почему: ${incident.cause}`,
    `Что делать: ${incident.resolution}`,
    `Технические детали: ${incident.technical}`,
  ].join("\n");
}

async function copyText(value: string) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value);
      return;
    } catch {
      // Some embedded and corporate browsers expose Clipboard API but deny it.
    }
  }
  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  textarea.remove();
  if (!copied) throw new Error("Браузер запретил доступ к буферу обмена.");
}

function formatBytes(bytes: number) {
  if (bytes <= 0) return "0 Б";
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} КБ`;
  return `${(bytes / 1024 / 1024).toFixed(1)} МБ`;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
