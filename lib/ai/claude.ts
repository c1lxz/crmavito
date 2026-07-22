import { adsAnalysisReportSchema, buildAdsAnalysisPrompt, type AdsAnalysisInput, type AdsAnalysisReport } from "@/lib/ai/ads-analysis";

type FetchFn = typeof fetch;

type AnthropicResponse = {
  content?: Array<{ type?: string; text?: string }>;
  message?: string;
  error?: { message?: string } | string;
};

export function getClaudeStatus() {
  return {
    configured: Boolean((process.env.CLAUDE_API_KEY || process.env.ANTHROPIC_API_KEY)?.trim()),
    model: (process.env.CLAUDE_MODEL || process.env.ANTHROPIC_MODEL)?.trim() || "claude-sonnet-4-6",
    baseUrl: (process.env.CLAUDE_BASE_URL || process.env.ANTHROPIC_BASE_URL)?.trim().replace(/\/$/, "") || "https://cc.freemodel.dev",
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
  options: { fetchFn?: FetchFn; apiKey?: string; baseUrl?: string; model?: string } = {},
): Promise<AdsAnalysisReport> {
  const apiKey = options.apiKey?.trim() || (process.env.CLAUDE_API_KEY || process.env.ANTHROPIC_API_KEY)?.trim();
  if (!apiKey) throw new Error("Claude не настроен: добавьте CLAUDE_API_KEY или ANTHROPIC_API_KEY на сервере.");

  const status = getClaudeStatus();
  const baseUrl = (options.baseUrl?.trim() || status.baseUrl).replace(/\/$/, "");
  const model = options.model?.trim() || status.model;
  let response: Response;
  try {
    response = await (options.fetchFn ?? fetch)(`${baseUrl}/v1/messages`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model,
        max_tokens: 6000,
        temperature: 0.2,
        messages: [{ role: "user", content: buildAdsAnalysisPrompt(input) }],
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(60_000),
    });
  } catch (error) {
    if (error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError")) {
      throw new Error("Claude не ответил за 60 секунд. Шлюз провайдера временно перегружен.");
    }
    throw error;
  }

  const rawBody = await response.text();
  let data: AnthropicResponse = {};
  try {
    data = rawBody ? JSON.parse(rawBody) as AnthropicResponse : {};
  } catch {
    data = {};
  }
  if (!response.ok) {
    const detail = (typeof data.error === "string" ? data.error : data.error?.message)?.trim()
      || data.message?.trim()
      || rawBody.trim().slice(0, 300);
    const endpointHint = response.status === 404
      ? " Провайдер не поддерживает Anthropic endpoint /v1/messages для этого ключа."
      : response.status === 403
        ? " Провайдер отклонил запрос: проверьте баланс и доступ ключа к Claude."
        : response.status >= 500
          ? " Шлюз Claude временно недоступен."
          : "";
    throw new Error(`Claude API: HTTP ${response.status}.${detail ? ` ${detail}` : ""}${endpointHint}`);
  }

  const parsedBody = data;
  const text = parsedBody.content?.filter((block) => block.type === "text").map((block) => block.text ?? "").join("\n").trim();
  if (!text) throw new Error("Claude вернул пустой отчёт.");

  const parsed = adsAnalysisReportSchema.safeParse(parseJsonObject(text));
  if (!parsed.success) throw new Error("Claude вернул отчёт с неверной структурой.");
  return parsed.data;
}
