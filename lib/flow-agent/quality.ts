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
  input: { productPath: string; backgroundPath: string; candidatePath: string; composition?: "detail" },
  options: { fetchFn?: typeof fetch; apiKey?: string; model?: string; retryRateLimits?: boolean } = {},
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
  const retryRateLimits = options.retryRateLimits !== false;
  const evaluateWithModel = async (activeModel: string, retryRateLimits: boolean) => {
    const request = { ...baseRequest, model: activeModel, retryRateLimits };
    const primary = await requestQualityVerdict(request, qualityPrompt(input.composition));
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
    return await evaluateWithModel(model, retryRateLimits && !hasFallback);
  } catch (error) {
    if (!(error instanceof GeminiQualityHttpError) || error.status !== 429 || !hasFallback) throw error;
    return evaluateWithModel(fallbackModel, retryRateLimits);
  }
}

export async function evaluateFlowOriginalDesignPair(
  input: {
    frontPath: string;
    backPath: string;
    sourcePaths?: string[];
    designBrief?: string;
    preserveWinnerLabel?: boolean;
  },
  options: { fetchFn?: typeof fetch; apiKey?: string; model?: string } = {},
): Promise<FlowPhotoQualityVerdict> {
  const apiKey = options.apiKey?.trim() || process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) return { pass: true, score: 0, issues: ["Gemini design-pair QA is not configured"], skipped: true };

  const model = options.model?.trim() || process.env.GEMINI_QA_MODEL?.trim() || "gemini-2.5-flash";
  const [front, back, sources] = await Promise.all([
    prepareVisionImage(input.frontPath),
    prepareVisionImage(input.backPath),
    Promise.all((input.sourcePaths || []).slice(0, 6).map(prepareVisionImage)),
  ]);
  return requestOriginalDesignVerdictWithFallback({
    apiKey,
    model,
    fetchFn: options.fetchFn || fetch,
    parts: [
      { text: originalDesignPairPrompt(input.preserveWinnerLabel) },
      ...(input.designBrief ? [{ text: `APPROVED PRODUCTION BRIEF — judge literal concept compliance against this brief: ${input.designBrief.slice(0, 3_000)}` }] : []),
      { text: "IMAGE A — intended FRONT anchor:" },
      { inline_data: { mime_type: "image/jpeg", data: front } },
      { text: "IMAGE B — intended BACK anchor:" },
      { inline_data: { mime_type: "image/jpeg", data: back } },
      ...sources.flatMap((source, index) => [
        { text: `SOURCE ${index + 1} — proven garment inspiration; its artwork must not be copied:` },
        { inline_data: { mime_type: "image/jpeg", data: source } },
      ]),
    ],
  });
}

export async function evaluateFlowOriginalDesignAnchor(
  input: {
    candidatePath: string;
    sourcePaths: string[];
    side: "front" | "back";
    designBrief?: string;
    preserveWinnerLabel?: boolean;
  },
  options: { fetchFn?: typeof fetch; apiKey?: string; model?: string } = {},
): Promise<FlowPhotoQualityVerdict> {
  const apiKey = options.apiKey?.trim() || process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) return { pass: true, score: 0, issues: ["Gemini original-design QA is not configured"], skipped: true };
  const model = options.model?.trim() || process.env.GEMINI_QA_MODEL?.trim() || "gemini-2.5-flash";
  const [candidate, sources] = await Promise.all([
    prepareVisionImage(input.candidatePath),
    Promise.all(input.sourcePaths.slice(0, 6).map(prepareVisionImage)),
  ]);
  return requestOriginalDesignVerdictWithFallback({
    apiKey,
    model,
    fetchFn: options.fetchFn || fetch,
    parts: [
      { text: originalDesignAnchorPrompt(input.side, input.preserveWinnerLabel) },
      ...(input.designBrief ? [{
        text: `APPROVED PRODUCTION BRIEF — judge literal ${input.side.toUpperCase()} concept compliance against this brief. This candidate intentionally shows only the ${input.side.toUpperCase()}; never require or penalize absence of the opposite side: ${input.designBrief.slice(0, 3_000)}`,
      }] : []),
      { text: `CANDIDATE — intended ${input.side.toUpperCase()} anchor:` },
      { inline_data: { mime_type: "image/jpeg", data: candidate } },
      ...sources.flatMap((source, index) => [
        { text: `SOURCE ${index + 1} — proven garment inspiration; preserve its garment/label rules but never copy its artwork:` },
        { inline_data: { mime_type: "image/jpeg", data: source } },
      ]),
    ],
  });
}

type OriginalDesignRequest = {
  apiKey: string;
  model: string;
  fetchFn: typeof fetch;
  parts: Array<{ text: string } | { inline_data: { mime_type: string; data: string } }>;
};

export async function evaluateCentralPrintPresence(candidatePath: string): Promise<FlowPhotoQualityVerdict> {
  const metadata = await sharp(candidatePath).metadata();
  const width = metadata.width || 0;
  const height = metadata.height || 0;
  if (width < 10 || height < 10) {
    return { pass: false, score: 0, issues: ["Generated anchor has invalid dimensions."] };
  }
  const region = {
    left: Math.round(width * 0.25),
    top: Math.round(height * 0.36),
    width: Math.max(1, Math.round(width * 0.5)),
    height: Math.max(1, Math.round(height * 0.34)),
  };
  const { data, info } = await sharp(candidatePath)
    .extract(region)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  let brightPixels = 0;
  for (let offset = 0; offset < data.length; offset += info.channels) {
    const luminance = data[offset] * 0.2126 + data[offset + 1] * 0.7152 + data[offset + 2] * 0.0722;
    if (luminance > 115) brightPixels += 1;
  }
  const brightRatio = brightPixels / (data.length / info.channels);
  if (brightRatio < 0.005) {
    return {
      pass: false,
      score: 0,
      issues: [`Mandatory central garment artwork is missing (${(brightRatio * 100).toFixed(2)}% visible print pixels).`],
    };
  }
  return { pass: true, score: 100, issues: [] };
}

async function requestOriginalDesignVerdictWithFallback(input: OriginalDesignRequest) {
  try {
    return await requestOriginalDesignVerdict(input);
  } catch (error) {
    const fallbackModel = process.env.GEMINI_QA_FALLBACK_MODEL?.trim() || "gemini-2.5-flash-lite";
    if (!(error instanceof GeminiQualityHttpError)
      || ![429, 500, 502, 503, 504].includes(error.status)
      || fallbackModel === input.model) throw error;
    return requestOriginalDesignVerdict({ ...input, model: fallbackModel });
  }
}

async function requestOriginalDesignVerdict(input: OriginalDesignRequest) {
  const response = await input.fetchFn(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(input.model)}:generateContent`,
    {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": input.apiKey },
      body: JSON.stringify({
        contents: [{ role: "user", parts: input.parts }],
        generationConfig: { temperature: 0, responseMimeType: "application/json" },
      }),
      signal: AbortSignal.timeout(60_000),
    },
  );
  const raw = await response.text();
  if (!response.ok) throw new GeminiQualityHttpError(response.status, `Gemini original-design QA: HTTP ${response.status}.`);
  const data = JSON.parse(raw) as GeminiQualityResponse;
  const text = data.candidates?.flatMap((candidateItem) => candidateItem.content?.parts || [])
    .map((part) => part.text || "")
    .find(Boolean);
  if (!text) throw new Error("Gemini original-design QA returned no verdict.");
  return parseQualityVerdict(text);
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

function qualityPrompt(composition?: "detail") {
  return [
    "Act as a strict product-photo quality gate. Compare the three labeled images.",
    "Pass only when IMAGE C unmistakably contains the exact garment from IMAGE A: same garment color and type, visible side, cut, collar, sleeves, seams, labels, and especially the exact artwork, letters, colors, count, shape, placement and scale of every print element.",
    "IMAGE B supplies only the supporting surface, framing, perspective and light. It often contains a different sample garment. Reject IMAGE C if it copied, mixed or retained any garment, artwork, label, text, logo or watermark from IMAGE B.",
    "Also reject obvious CGI, pasted edges, floating cloth, broken geometry, illegible changed text, duplicated details, or any marketplace watermark.",
    "Reject every hang tag, paper tag, sewn label, woven tab, white collar locator, plastic fastener, string or cropped tag fragment. Heat-transfer neck markings belong only inside the back-neck panel and must never appear on the outer chest or outer back.",
    composition === "detail"
      ? "DETAIL COMPOSITION GATE: IMAGE C must be a genuinely new oblique camera photograph, not a digital crop or texture-only macro. The complete print occupies about 35-50% of frame and is not cut. Require a visible collar, at least one complete sleeve, a garment edge, natural folds and a clear band of IMAGE B background around the shirt."
      : "",
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

function originalDesignPairPrompt(preserveWinnerLabel = false) {
  return [
    "Act as a strict fashion design front/back quality gate.",
    preserveWinnerLabel
      ? "IMAGE A must visibly be the FRONT of one garment. If its inside back-neck panel is visible, it must carry the exact internal label or heat-transfer marking from the SOURCE winner; that marking must never appear on the outer chest."
      : "IMAGE A must visibly be the FRONT of one garment with a clean crew-neck shape. The internal heat-transfer neck marking is physically hidden inside the back-neck panel and no label wording may appear on the outer chest.",
    "IMAGE B must visibly be the BACK of the same garment: higher closed rear neckline, with no inside label text printed on the exterior.",
    "The sides must share garment cut, color, ink palette, distress treatment and one coherent story, while using clearly different primary subjects and silhouettes. The front is a restrained secondary hook and the back is the hero statement. Reject if B repeats, mirrors, enlarges, fragments or merely re-photographs A's principal object, figure, hand, face, symbol or graphic.",
    preserveWinnerLabel
      ? "Require the SOURCE winner's exact internal collar marking on the visible inside panel of IMAGE A. Reject invented, changed or missing markings, hang tags, fasteners and any label text on either exterior; IMAGE B remains label-free because it shows the outside back."
      : "Reject every hang tag, paper tag, sewn label, woven tab, white collar locator, plastic fastener, string or cropped tag fragment. The only permitted label construction is an internal heat-transfer marking hidden inside the back-neck panel; no label wording may appear on either exterior.",
    "Production gate: on each side the complete artwork must occupy one compact rectangular torso print zone equivalent to at most 24 x 32 cm, with clear fabric margins from collar, shoulders, sleeves, sides and hem. Reject all-over, tiled, wraparound, sleeve, seam-crossing or edge-to-edge artwork and reject graphics covering most of the garment.",
    "Reject random abstract squares, rectangles, grids, panels or color fields. A distressed halftone portrait/figure is allowed when integrated without a rectangular edge. A text-led editorial system is also valid when the APPROVED PRODUCTION BRIEF explicitly requests typography. Require a specific coherent concept and intentional front/back hierarchy rather than arbitrary decoration.",
    "Commercial taste gate: reject radial rings of repeated objects, eye/oval/swoosh marks, lone numbers over abstract blobs, tiny centered tokens on blank sides, esports/tech/sports branding, arbitrary badges, invented brand names, holographic or glossy-vinyl effects, and any composition that reads as a generic AI logo instead of collectible fashion. Reject a supporting side that is functionally blank.",
    "All SOURCE images are inspiration only. Reject if either candidate reuses a recognizable source subject, symbol, silhouette or motif (including any source stars, horse/equine figure or exact composition), even when moved, resized or redrawn.",
    "Reject generic animals, buffalo/yak/bear/wolf/horse, the winner's stars, unrelated clipart, an unrequested lone chest logo, CUSTOM MADE, visible brand-label text on the back exterior, obvious CGI, malformed clothing or unreadable fake typography. An exact word or phrase required by the APPROVED PRODUCTION BRIEF is not a logo and must be judged by that brief.",
    "Return only JSON: {\"pass\":boolean,\"score\":integer 0..100,\"issues\":[short actionable strings]}. Passing requires score >= 85 and every orientation/coherence rule to pass.",
  ].filter(Boolean).join(" ");
}

function originalDesignAnchorPrompt(side: "front" | "back", preserveWinnerLabel = false) {
  return [
    `Act as a strict original designer-fashion ${side} anchor gate.`,
    side === "front"
      ? preserveWinnerLabel
        ? "The candidate must unmistakably show the FRONT and expose enough of the inside back-neck panel to verify the exact internal label or heat-transfer marking from the SOURCE winner. No label wording may appear on the outer chest."
        : "The candidate must unmistakably show the FRONT with a clean crew-neck shape. The internal heat-transfer marking is hidden inside the back-neck panel; no label wording may appear on the outer chest."
      : "The candidate must unmistakably show the BACK: higher closed rear neckline and no label wording printed on the exterior.",
    side === "front" && preserveWinnerLabel
      ? "Compare the candidate's internal neck marking to the SOURCE winner exactly. Reject a missing, invented, changed, mirrored or relocated marking, plus every hang tag, fastener, string or exterior label."
      : "Reject every hang tag, paper tag, sewn label, woven tab, white collar locator, plastic fastener, string or cropped tag fragment. Do not accept L.G.B., size text or any label wording anywhere visible in this exterior product shot.",
    "The candidate must be a genuinely new, commercially credible archive-fashion design with intentional hierarchy, asymmetry, negative space and physical screen-print integration.",
    "Production gate: the entire artwork must fit one compact torso rectangle equivalent to at most 24 x 32 cm and leave clearly visible margins from collar, shoulders, sleeves, sides and hem. Reject all-over, tiled, wraparound, sleeve, seam-crossing, edge-to-edge or garment-dominating graphics.",
    "Reject random abstract squares, rectangles, grids, panels and color fields. A distressed halftone portrait/figure is allowed when integrated without a rectangular edge. A text-led editorial composition is also valid when the APPROVED PRODUCTION BRIEF explicitly requests typography. Require one specific coherent concept, not arbitrary decoration.",
    "Commercial taste gate: reject radial rings of repeated objects, eye/oval/swoosh marks, lone numbers over abstract blobs, tiny centered tokens, esports/tech/sports branding, arbitrary badges, invented brand names, holographic or glossy-vinyl effects, and anything that reads as a generic AI logo rather than collectible fashion.",
    "SOURCE images teach garment construction and design quality only. Reject any recognizable reuse of their subject, symbol, silhouette or motif—including source stars, horse/equine imagery or the same composition—even if moved, resized, mirrored or redrawn.",
    "Reject generic animals, buffalo/yak/bear/wolf/horse, the winner's stars, unrelated stock clipart, an unrequested lone chest logo, CUSTOM MADE, random fake text, obvious CGI, malformed clothing or pasted artwork. An exact word required by the APPROVED PRODUCTION BRIEF is not a logo and must be judged by the requested typographic treatment.",
    "Return only JSON: {\"pass\":boolean,\"score\":integer 0..100,\"issues\":[short actionable strings]}. Passing requires score >= 85 and no originality, orientation, label or fashion-quality issue.",
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
