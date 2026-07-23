import { brotliDecompressSync } from "node:zlib";
import { createHash } from "node:crypto";
import { adsAnalysisReportSchema, buildAdsAnalysisPrompt, type AdsAnalysisInput, type AdsAnalysisReport } from "@/lib/ai/ads-analysis";

type FetchFn = typeof fetch;

type AnthropicResponse = {
  content?: Array<{ type?: string; text?: string }>;
  message?: string;
  error?: { message?: string } | string;
  stop_reason?: string | null;
};

const reportCache = new Map<string, { expiresAt: number; report: AdsAnalysisReport }>();
const REPORT_CACHE_TTL_MS = 30 * 60 * 1000;

export function getClaudeStatus() {
  return {
    configured: Boolean((process.env.CLAUDE_API_KEY || process.env.ANTHROPIC_API_KEY)?.trim()),
    model: (process.env.CLAUDE_MODEL || process.env.ANTHROPIC_MODEL)?.trim() || "claude-opus-4-8",
    fallbackModel: (process.env.CLAUDE_FALLBACK_MODEL || process.env.ANTHROPIC_FALLBACK_MODEL)?.trim() || "claude-opus-4-8",
    baseUrl: (process.env.CLAUDE_BASE_URL || process.env.ANTHROPIC_BASE_URL)?.trim().replace(/\/$/, "") || "https://customix.fun/api",
  };
}

function parseJsonObject(text: string): unknown {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)?.[1];
  const candidate = fenced ?? trimmed;
  try {
    return JSON.parse(candidate);
  } catch {
    const start = candidate.indexOf("{");
    const end = candidate.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(candidate.slice(start, end + 1));
    throw new Error("Claude вернул ответ не в формате JSON.");
  }
}

export async function createClaudeAdsReport(
  input: AdsAnalysisInput,
  options: {
    fetchFn?: FetchFn;
    apiKey?: string;
    baseUrl?: string;
    model?: string;
    fallbackModel?: string;
    maxAttempts?: number;
    retryDelaysMs?: number[];
  } = {},
): Promise<AdsAnalysisReport> {
  const apiKey = options.apiKey?.trim() || (process.env.CLAUDE_API_KEY || process.env.ANTHROPIC_API_KEY)?.trim();
  if (!apiKey) throw new Error("Claude не настроен: добавьте CLAUDE_API_KEY или ANTHROPIC_API_KEY на сервере.");

  const status = getClaudeStatus();
  const baseUrl = (options.baseUrl?.trim() || status.baseUrl).replace(/\/$/, "");
  const model = options.model?.trim() || status.model;
  const fallbackModel = options.fallbackModel?.trim() || status.fallbackModel;
  const maxTokens = readBoundedInteger(process.env.CLAUDE_MAX_TOKENS, 12000, 4000, 20000);
  const maxAttempts = Math.max(1, Math.min(options.maxAttempts ?? 5, 5));
  const cacheKey = options.fetchFn || options.apiKey || options.baseUrl || options.model
    ? null
    : createHash("sha256").update(JSON.stringify(input)).digest("hex");
  const cached = cacheKey ? reportCache.get(cacheKey) : undefined;
  if (cached && cached.expiresAt > Date.now()) return cached.report;
  const attemptModels = Array.from(
    { length: maxAttempts },
    (_, index) => maxAttempts > 1 && index === maxAttempts - 1 ? fallbackModel : model,
  );
  let lastResponse: Response | null = null;
  let rawBody = "";
  let data: AnthropicResponse = {};
  let maxTokenRetryUsed = false;
  let requestMaxTokens = maxTokens;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const attemptModel = attemptModels[attempt - 1];
    try {
      lastResponse = await (options.fetchFn ?? fetch)(`${baseUrl}/v1/messages`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "accept-encoding": "identity",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: attemptModel,
          max_tokens: requestMaxTokens,
          messages: [{ role: "user", content: buildAdsAnalysisPrompt(input) }],
        }),
        cache: "no-store",
        signal: AbortSignal.timeout(75_000),
      });
      rawBody = await readClaudeBody(lastResponse);
      try {
        data = rawBody ? JSON.parse(rawBody) as AnthropicResponse : {};
      } catch {
        data = {};
      }

      const responseText = data.content?.filter((block) => block.type === "text").map((block) => block.text ?? "").join("\n").trim();
      if (lastResponse.ok && data.stop_reason === "max_tokens" && !maxTokenRetryUsed && attempt < maxAttempts) {
        maxTokenRetryUsed = true;
        requestMaxTokens = Math.min(20000, Math.max(requestMaxTokens + 4000, 16000));
        continue;
      }
      if (lastResponse.ok && responseText) break;
      if (!isRetryableClaudeFailure(lastResponse.status, rawBody) || attempt === maxAttempts) break;
      await delay(getRetryDelayMs(lastResponse, rawBody, attempt, options.retryDelaysMs));
    } catch (error) {
      if (error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError")) {
        if (attempt < maxAttempts) {
          await delay(attempt * 1500);
          continue;
        }
        throw new Error("Claude не ответил после нескольких попыток. Шлюз провайдера временно перегружен.");
      }
      throw error;
    }
  }

  if (!lastResponse) throw new Error("Claude не ответил.");
  if (!lastResponse.ok) {
    const detail = getClaudeErrorDetail(data, rawBody);
    const endpointHint = lastResponse.status === 403 && /account tier is insufficient|insufficient for this service/i.test(rawBody)
      ? " FreeModel не разрешает Claude для текущего Tier аккаунта. Новый ключ того же аккаунта не поможет: разблокируйте T1+ пополнением и укажите его Anthropic endpoint."
      : lastResponse.status === 404
      ? " Провайдер не поддерживает Anthropic endpoint /v1/messages для этого ключа."
      : lastResponse.status === 403
        ? " Провайдер отклонил запрос: проверьте баланс и доступ ключа к Claude."
        : lastResponse.status >= 500
          ? " Шлюз Claude временно недоступен."
          : "";
    throw new Error(`Claude API: HTTP ${lastResponse.status}.${detail ? ` ${detail}` : ""}${endpointHint}`);
  }

  const parsedBody = data;
  if (parsedBody.stop_reason === "max_tokens") {
    throw new Error("Claude не смог завершить отчёт даже с расширенным лимитом ответа. Повторите запрос.");
  }
  const text = parsedBody.content?.filter((block) => block.type === "text").map((block) => block.text ?? "").join("\n").trim();
  if (!text) {
    const detail = rawBody.trim().slice(0, 300);
    throw new Error(detail
      ? `Шлюз Claude не смог запустить анализ: ${detail}`
      : "Claude вернул пустой отчёт.");
  }

  const parsed = adsAnalysisReportSchema.safeParse(parseJsonObject(text));
  if (!parsed.success) throw new Error("Claude вернул отчёт с неверной структурой.");
  if (cacheKey) {
    reportCache.set(cacheKey, {
      expiresAt: Date.now() + REPORT_CACHE_TTL_MS,
      report: parsed.data,
    });
  }
  return parsed.data;
}

function isRetryableClaudeFailure(status: number, body: string) {
  if (status === 403 && /account tier is insufficient|insufficient for this service/i.test(body)) return false;
  return status === 403 || status === 429 || status >= 500 || /maximum number of running container|failed to start container|error code:\s*1101|overload|temporar/i.test(body);
}

function getClaudeErrorDetail(data: AnthropicResponse, rawBody: string) {
  const structured = (typeof data.error === "string" ? data.error : data.error?.message)?.trim() || data.message?.trim();
  if (structured) return structured;
  const plain = rawBody.trim();
  if (/<!doctype\s+html|<html[\s>]/i.test(plain)) return "";
  return plain.slice(0, 300);
}

function delay(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function getRetryDelayMs(response: Response, body: string, attempt: number, configured?: number[]) {
  const configuredDelay = configured?.[attempt - 1];
  if (configuredDelay !== undefined) return Math.max(0, configuredDelay);

  const retryAfter = Number.parseFloat(response.headers.get("retry-after") ?? "");
  if (Number.isFinite(retryAfter) && retryAfter > 0) {
    return Math.min(25_000, Math.max(1_000, retryAfter * 1000));
  }
  if (response.status === 429 && /concurrency reached|limit:\s*\d+/i.test(body)) {
    return [3_000, 7_000, 15_000, 25_000][attempt - 1] ?? 25_000;
  }
  return attempt * 1500;
}

function readBoundedInteger(value: string | undefined, fallback: number, minimum: number, maximum: number) {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(minimum, Math.min(parsed, maximum));
}

async function readClaudeBody(response: Response) {
  const bytes = Buffer.from(await response.arrayBuffer());
  const plain = bytes.toString("utf8");
  if (looksLikeJsonOrText(plain)) return plain;
  try {
    const decompressed = brotliDecompressSync(bytes).toString("utf8");
    if (looksLikeJsonOrText(decompressed)) return decompressed;
  } catch {
    // Some gateway responses are plain text and not compressed.
  }
  return plain;
}

function looksLikeJsonOrText(value: string) {
  const trimmed = value.trim();
  return trimmed.startsWith("{")
    || trimmed.startsWith("[")
    || /^[\x09\x0A\x0D\x20-\x7E\u0400-\u04FF]{4,}$/.test(trimmed);
}
