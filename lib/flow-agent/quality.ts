import { readFile } from "node:fs/promises";
import type { Page } from "playwright";
import sharp from "sharp";

export type FlowPhotoQualityVerdict = {
  pass: boolean;
  score: number;
  issues: string[];
  skipped?: boolean;
};

type GeminiQualityResponse = {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  error?: { message?: string };
};

export async function evaluateFlowProductPhoto(
  input: { productPath: string; backgroundPath: string; candidatePath: string },
  options: { fetchFn?: typeof fetch; apiKey?: string; model?: string } = {},
): Promise<FlowPhotoQualityVerdict> {
  const apiKey = options.apiKey?.trim() || process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) return { pass: true, score: 0, issues: ["Gemini QA не настроен"], skipped: true };

  const model = options.model?.trim() || process.env.GEMINI_QA_MODEL?.trim() || "gemini-2.5-flash";
  const fallbackModel = process.env.GEMINI_QA_FALLBACK_MODEL?.trim() || "gemini-2.5-flash-lite";
  const [product, background, candidate] = await Promise.all([
    prepareVisionImage(input.productPath),
    prepareVisionImage(input.backgroundPath),
    prepareVisionImage(input.candidatePath),
  ]);
  const baseRequest = { apiKey, fetchFn: options.fetchFn || fetch, product, background, candidate };
  const evaluateWithModel = async (activeModel: string, retryRateLimits: boolean) => {
    const request = { ...baseRequest, model: activeModel, retryRateLimits };
    const primary = await requestQualityVerdict(request, qualityPrompt());
    if (!primary.pass) return primary;
    const identityAudit = await requestQualityVerdict(request, identityAuditPrompt());
    return {
      pass: identityAudit.pass,
      score: Math.min(primary.score, identityAudit.score),
      issues: [...new Set([...primary.issues, ...identityAudit.issues])].slice(0, 8),
    };
  };
  const hasFallback = Boolean(fallbackModel && fallbackModel !== model);
  try {
    return await evaluateWithModel(model, !hasFallback);
  } catch (error) {
    if (!(error instanceof GeminiQualityHttpError) || error.status !== 429 || !hasFallback) throw error;
    return evaluateWithModel(fallbackModel, true);
  }
}

class GeminiQualityHttpError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = "GeminiQualityHttpError";
  }
}

async function requestQualityVerdict(
  input: { apiKey: string; model: string; fetchFn: typeof fetch; product: string; background: string; candidate: string; retryRateLimits: boolean },
  prompt: string,
) {
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    let response: Response;
    try {
      response = await input.fetchFn(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(input.model)}:generateContent`,
        {
          method: "POST",
          headers: { "content-type": "application/json", "x-goog-api-key": input.apiKey },
          body: JSON.stringify({
            contents: [{
              role: "user",
              parts: [
                { text: prompt },
                { text: "IMAGE A — source product that must be preserved exactly:" },
                { inline_data: { mime_type: "image/jpeg", data: input.product } },
                { text: "IMAGE B — scene reference; any product, print, label, text or watermark in it must NOT be copied:" },
                { inline_data: { mime_type: "image/jpeg", data: input.background } },
                { text: "IMAGE C — generated candidate to inspect:" },
                { inline_data: { mime_type: "image/jpeg", data: input.candidate } },
              ],
            }],
            generationConfig: { temperature: 0, responseMimeType: "application/json" },
          }),
          signal: AbortSignal.timeout(60_000),
        },
      );
    } catch (error) {
      if (attempt === 4) throw error;
      await new Promise((resolve) => setTimeout(resolve, Math.min(5_000, attempt * 1_000)));
      continue;
    }
    const raw = await response.text();
    let data: GeminiQualityResponse = {};
    try {
      data = JSON.parse(raw) as GeminiQualityResponse;
    } catch {
      // The response error below is more useful than a JSON parser exception.
    }
    if (!response.ok) {
      if (attempt < 4 && ((response.status === 429 && input.retryRateLimits) || response.status >= 500)) {
        await new Promise((resolve) => setTimeout(resolve, qualityRetryDelayMs(response, raw, attempt)));
        continue;
      }
      throw new GeminiQualityHttpError(response.status, `Gemini QA: HTTP ${response.status}. ${data.error?.message || "Проверка качества недоступна."}`);
    }
    const text = data.candidates?.flatMap((candidateItem) => candidateItem.content?.parts || [])
      .map((part) => part.text || "")
      .find(Boolean);
    if (!text) throw new Error("Gemini QA не вернул оценку изображения.");
    return parseQualityVerdict(text);
  }
  throw new Error("Gemini QA не завершил проверку после повторов.");
}

export function qualityRetryDelayMs(response: Response, body: string, attempt: number) {
  const retryAfter = Number.parseFloat(response.headers.get("retry-after") || "");
  const bodySeconds = Number.parseFloat(body.match(/retry in ([0-9.]+)s/i)?.[1] || "");
  const seconds = Number.isFinite(retryAfter) && retryAfter > 0
    ? retryAfter
    : Number.isFinite(bodySeconds) && bodySeconds > 0 ? bodySeconds : attempt * 5;
  // Gemini's free-tier window commonly asks for almost a full minute. Retrying
  // earlier can keep extending that window, so respect the advertised delay.
  return Math.min(90_000, Math.max(1_000, Math.ceil(seconds * 1_000) + 1_500));
}

export function browserPageFetch(page: Page): typeof fetch {
  return (async (input: URL | RequestInfo, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const headers = Object.fromEntries(new Headers(init?.headers).entries());
    if (init?.body != null && typeof init.body !== "string") throw new Error("Browser proxy fetch supports string request bodies only.");
    const result = await page.evaluate(async (request) => {
      const response = await fetch(request.url, {
        method: request.method,
        headers: request.headers,
        body: request.body,
        cache: "no-store",
      });
      return {
        body: await response.text(),
        headers: Object.fromEntries(response.headers.entries()),
        status: response.status,
        statusText: response.statusText,
      };
    }, { url, method: init?.method || "GET", headers, body: init?.body || undefined });
    return new Response(result.body, {
      status: result.status,
      statusText: result.statusText,
      headers: result.headers,
    });
  }) as typeof fetch;
}

async function prepareVisionImage(filePath: string) {
  const source = await readFile(filePath);
  return (await sharp(source)
    .rotate()
    .resize({ width: 1024, height: 1024, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 82, mozjpeg: true })
    .toBuffer()).toString("base64");
}

function qualityPrompt() {
  return [
    "Act as a strict product-photo quality gate. Compare the three labeled images.",
    "Pass only when IMAGE C unmistakably contains the exact garment from IMAGE A: same garment color and type, visible side, cut, collar, sleeves, seams, labels, and especially the exact artwork, letters, colors, count, shape, placement and scale of every print element.",
    "IMAGE B supplies only the supporting surface, framing, perspective and light. It often contains a different sample garment. Reject IMAGE C if it copied, mixed or retained any garment, artwork, label, text, logo or watermark from IMAGE B.",
    "Also reject obvious CGI, pasted edges, floating cloth, broken geometry, illegible changed text, duplicated details, or any marketplace watermark.",
    "Natural changes in folds, camera angle, crop and lighting are allowed. Be conservative: uncertainty about product identity is a failure.",
    "Return only JSON: {\"pass\":boolean,\"score\":integer 0..100,\"issues\":[short strings]}. Passing requires score >= 85 and no product-identity or watermark issue.",
  ].join(" ");
}

function identityAuditPrompt() {
  return [
    "Perform a second, independent product-identity audit of IMAGE A versus IMAGE C. IMAGE B is scene-only and must not contribute product details.",
    "Before deciding, explicitly count every distinct printed motif or artwork element in A and C (for example each separate star), then compare each element's outline versus fill, texture, color, relative size and position.",
    "Transcribe every visible word, letter and neck label in A and C and compare spelling, punctuation and placement.",
    "Reject any missing, duplicated, added, merged, recolored or restyled motif even if the overall garment looks convincing. Reject hidden or changed labels and any watermark.",
    "Camera angle, folds, crop and lighting may change, but they cannot hide an identity detail visible in A.",
    "Return only JSON: {\"pass\":boolean,\"score\":integer 0..100,\"issues\":[short strings including element counts when relevant]}. Pass only if every counted motif and all visible text match exactly.",
  ].join(" ");
}

export function parseQualityVerdict(raw: string): FlowPhotoQualityVerdict {
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("Gemini QA вернул ответ без JSON.");
  const parsed = JSON.parse(match[0]) as { pass?: unknown; score?: unknown; issues?: unknown };
  const numericScore = Number(parsed.score);
  if (typeof parsed.pass !== "boolean" || !Number.isFinite(numericScore)) throw new Error("Gemini QA вернул некорректную оценку.");
  const score = Math.max(0, Math.min(100, Math.round(numericScore)));
  const issues = Array.isArray(parsed.issues)
    ? parsed.issues.filter((issue): issue is string => typeof issue === "string").slice(0, 8)
    : [];
  return { pass: parsed.pass && score >= 85, score, issues };
}
