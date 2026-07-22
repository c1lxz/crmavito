import { adsAnalysisReportSchema, buildAdsAnalysisPrompt, type AdsAnalysisInput, type AdsAnalysisReport } from "@/lib/ai/ads-analysis";

type FetchFn = typeof fetch;

type AnthropicResponse = {
  content?: Array<{ type?: string; text?: string }>;
  error?: { message?: string };
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
  const response = await (options.fetchFn ?? fetch)(`${baseUrl}/v1/messages`, {
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
    signal: AbortSignal.timeout(90_000),
  });

  const data = await response.json().catch(() => ({})) as AnthropicResponse;
  if (!response.ok) {
    const detail = data.error?.message?.trim();
    const endpointHint = response.status === 404
      ? " Провайдер не поддерживает Anthropic endpoint /v1/messages для этого ключа."
      : "";
    throw new Error(`Claude API: HTTP ${response.status}.${detail ? ` ${detail}` : ""}${endpointHint}`);
  }

  const text = data.content?.filter((block) => block.type === "text").map((block) => block.text ?? "").join("\n").trim();
  if (!text) throw new Error("Claude вернул пустой отчёт.");

  const parsed = adsAnalysisReportSchema.safeParse(parseJsonObject(text));
  if (!parsed.success) throw new Error("Claude вернул отчёт с неверной структурой.");
  return parsed.data;
}
