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
  const [product, background, candidate] = await Promise.all([
    prepareVisionImage(input.productPath),
    prepareVisionImage(input.backgroundPath),
    prepareVisionImage(input.candidatePath),
  ]);
  const response = await (options.fetchFn || fetch)(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
    {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({
        contents: [{
          role: "user",
          parts: [
            { text: qualityPrompt() },
            { text: "IMAGE A — source product that must be preserved exactly:" },
            { inline_data: { mime_type: "image/jpeg", data: product } },
            { text: "IMAGE B — scene reference; any product, print, label, text or watermark in it must NOT be copied:" },
            { inline_data: { mime_type: "image/jpeg", data: background } },
            { text: "IMAGE C — generated candidate to inspect:" },
            { inline_data: { mime_type: "image/jpeg", data: candidate } },
          ],
        }],
        generationConfig: { temperature: 0, responseMimeType: "application/json" },
      }),
      signal: AbortSignal.timeout(60_000),
    },
  );
  const raw = await response.text();
  let data: GeminiQualityResponse = {};
  try {
    data = JSON.parse(raw) as GeminiQualityResponse;
  } catch {
    // The response error below is more useful than a JSON parser exception.
  }
  if (!response.ok) throw new Error(`Gemini QA: HTTP ${response.status}. ${data.error?.message || "Проверка качества недоступна."}`);
  const text = data.candidates?.flatMap((candidateItem) => candidateItem.content?.parts || [])
    .map((part) => part.text || "")
    .find(Boolean);
  if (!text) throw new Error("Gemini QA не вернул оценку изображения.");
  return parseQualityVerdict(text);
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
