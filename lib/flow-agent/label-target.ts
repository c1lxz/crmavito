import sharp from "sharp";
import { ProxyAgent } from "undici";
import { getClaudeStatus } from "../ai/claude";

type ProxyFetchInit = RequestInit & { dispatcher?: ProxyAgent };

let cachedProxyUrl: string | null = null;
let cachedProxyAgent: ProxyAgent | null = null;

export type NeckLabelTarget = {
  centerX: number;
  centerY: number;
  widthRatio: number;
  rotationDeg: number;
  confidence: number;
};

type GeminiResponse = {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  error?: { message?: string };
};

type ClaudeResponse = {
  content?: Array<{ type?: string; text?: string }>;
  error?: { message?: string } | string;
};

export async function locateInsideNeckLabelTarget(
  image: Buffer,
  options: { fetchFn?: typeof fetch; apiKey?: string; model?: string } = {},
): Promise<NeckLabelTarget> {
  const apiKey = options.apiKey?.trim() || process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) throw new Error("Gemini neck-panel locator is not configured.");
  const model = options.model?.trim() || process.env.GEMINI_QA_MODEL?.trim() || "gemini-2.5-flash";
  const prepared = await sharp(image).rotate()
    .resize({ width: 1400, height: 1400, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 86, mozjpeg: true }).toBuffer();
  const fetchFn = options.fetchFn || fetch;
  const models = [...new Set([model, "gemini-2.5-flash-lite"])];
  let response: Response | undefined;
  let raw = "";
  let data: GeminiResponse = {};
  let geminiTransportError: unknown;
  try {
    for (const candidateModel of models) {
      response = await fetchFn(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(candidateModel)}:generateContent`,
        withVisionProxy({
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [
          { text: [
            "Locate the visible INSIDE rear neck panel of this front-facing flat-lay T-shirt.",
            "The target is the fabric area enclosed just below the rear half of the crew-neck ribbing, where a heat-transfer brand mark is physically printed.",
            "Never target the outer collar rib, exterior chest, shoulder, background, seam, existing outer artwork or empty space above the shirt.",
            "The complete label must fit on shirt fabric inside the neck opening. If that inside panel is not clearly visible, set visiblePanel false.",
            "Coordinates are normalized 0..1 over the full image. widthRatio should normally be 0.04..0.10. rotationDeg follows the local collar angle, limited to -20..20.",
            "Return only JSON: {\"visiblePanel\":boolean,\"confidence\":number,\"centerX\":number,\"centerY\":number,\"widthRatio\":number,\"rotationDeg\":number}.",
          ].join("\n") },
          { inline_data: { mime_type: "image/jpeg", data: prepared.toString("base64") } },
        ] }],
        generationConfig: { temperature: 0, responseMimeType: "application/json" },
      }),
      signal: AbortSignal.timeout(60_000),
        }, fetchFn),
      );
      raw = await response.text();
      data = {};
      try { data = JSON.parse(raw) as GeminiResponse; } catch { /* handled below */ }
      if (response.ok || response.status !== 429) break;
    }
  } catch (error) {
    geminiTransportError = error;
  }
  if (!response?.ok) {
    try {
      return await locateWithClaude(prepared, fetchFn);
    } catch (claudeError) {
      const geminiDetail = geminiTransportError instanceof Error
        ? geminiTransportError.message
        : `HTTP ${response?.status || 500}. ${data.error?.message || "Unavailable"}`;
      throw new Error(`Neck-panel locator unavailable. Gemini: ${geminiDetail}. Claude: ${claudeError instanceof Error ? claudeError.message : String(claudeError)}`);
    }
  }
  const text = data.candidates?.flatMap((candidate) => candidate.content?.parts || [])
    .map((part) => part.text || "").find(Boolean);
  const match = text?.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("Neck-panel locator returned invalid JSON.");
  return validateTarget(JSON.parse(match[0]) as Record<string, unknown>);
}

async function locateWithClaude(image: Buffer, fetchFn: typeof fetch): Promise<NeckLabelTarget> {
  const apiKey = (process.env.CLAUDE_API_KEY || process.env.ANTHROPIC_API_KEY)?.trim();
  if (!apiKey) throw new Error("Claude neck-panel locator is not configured.");
  const status = getClaudeStatus();
  const response = await fetchFn(`${status.baseUrl}/v1/messages`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "accept-encoding": "identity",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: status.model,
      max_tokens: 350,
      temperature: 0,
      messages: [{ role: "user", content: [
        { type: "image", source: { type: "base64", media_type: "image/jpeg", data: image.toString("base64") } },
        { type: "text", text: neckPanelPrompt() },
      ] }],
    }),
    signal: AbortSignal.timeout(90_000),
  });
  const raw = await response.text();
  let data: ClaudeResponse = {};
  try { data = raw ? JSON.parse(raw) as ClaudeResponse : {}; } catch { /* handled below */ }
  if (!response.ok) {
    const detail = (typeof data.error === "string" ? data.error : data.error?.message) || raw.slice(0, 240);
    throw new Error(`HTTP ${response.status}. ${detail}`);
  }
  const text = data.content?.filter((part) => part.type === "text").map((part) => part.text || "").join("\n");
  const match = text?.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("Claude returned invalid neck-panel JSON.");
  return validateTarget(JSON.parse(match[0]) as Record<string, unknown>);
}

function validateTarget(parsed: Record<string, unknown>): NeckLabelTarget {
  const confidence = Number(parsed.confidence);
  const centerX = Number(parsed.centerX);
  const centerY = Number(parsed.centerY);
  const widthRatio = Number(parsed.widthRatio);
  const rotationDeg = Number(parsed.rotationDeg);
  if (parsed.visiblePanel !== true || !Number.isFinite(confidence) || confidence < 0.75) {
    throw new Error("The generated front photo does not clearly expose the inside back-neck panel.");
  }
  if (![centerX, centerY, widthRatio, rotationDeg].every(Number.isFinite)
    || centerX < 0.15 || centerX > 0.85 || centerY < 0.08 || centerY > 0.38
    || widthRatio < 0.025 || widthRatio > 0.14 || Math.abs(rotationDeg) > 20) {
    throw new Error("Neck-panel locator returned unsafe label coordinates.");
  }
  return { centerX, centerY, widthRatio, rotationDeg, confidence };
}

function neckPanelPrompt() {
  return [
    "Locate the visible INSIDE rear neck panel of this front-facing flat-lay T-shirt.",
    "Target only the fabric enclosed just below the rear half of the crew-neck ribbing, where a heat-transfer brand mark physically belongs.",
    "Never target outer collar rib, exterior chest, shoulder, background, seam, artwork or empty space above the shirt.",
    "The complete label must fit inside the neck opening. If that inside panel is not clearly visible, set visiblePanel false.",
    "Coordinates are normalized 0..1 over the full image. widthRatio normally 0.04..0.10; rotationDeg -20..20.",
    "Return only JSON: {\"visiblePanel\":boolean,\"confidence\":number,\"centerX\":number,\"centerY\":number,\"widthRatio\":number,\"rotationDeg\":number}.",
  ].join("\n");
}

function withVisionProxy(init: RequestInit, fetchFn: typeof fetch): RequestInit {
  if (fetchFn !== fetch) return init;
  const proxyUrl = getVisionProxyUrl();
  if (!proxyUrl) return init;
  if (cachedProxyUrl !== proxyUrl) {
    cachedProxyUrl = proxyUrl;
    cachedProxyAgent = new ProxyAgent(proxyUrl);
  }
  return { ...init, dispatcher: cachedProxyAgent || undefined } as ProxyFetchInit;
}

function getVisionProxyUrl(): string | null {
  const raw = process.env.CONTENT_MACHINE_VISION_PROXY_URL?.trim();
  if (!raw) return null;
  const schemeMatch = raw.match(/^(https?):\/\/(.+)$/i);
  const value = schemeMatch?.[2] || raw;
  const authAtHost = value.match(/^([^:@]+):([^@]+)@([^:]+):(\d+)$/);
  if (authAtHost) {
    const [, username, password, host, port] = authAtHost;
    return `http://${encodeURIComponent(username)}:${encodeURIComponent(password)}@${host}:${port}`;
  }
  const parts = value.split(":");
  if (parts.length === 4) {
    const [host, port, username, password] = parts;
    return `http://${encodeURIComponent(username)}:${encodeURIComponent(password)}@${host}:${port}`;
  }
  return schemeMatch ? raw : `http://${raw}`;
}
