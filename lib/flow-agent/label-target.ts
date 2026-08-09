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
      try {
        return await locateInsideNeckLabelTargetByEdges(prepared);
      } catch (edgeError) {
      const geminiDetail = geminiTransportError instanceof Error
        ? geminiTransportError.message
        : `HTTP ${response?.status || 500}. ${data.error?.message || "Unavailable"}`;
        throw new Error(`Neck-panel locator unavailable. Gemini: ${geminiDetail}. Claude: ${claudeError instanceof Error ? claudeError.message : String(claudeError)}. Local collar gate: ${edgeError instanceof Error ? edgeError.message : String(edgeError)}`);
      }
    }
  }
  const text = data.candidates?.flatMap((candidate) => candidate.content?.parts || [])
    .map((part) => part.text || "").find(Boolean);
  const match = text?.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("Neck-panel locator returned invalid JSON.");
  return validateTarget(JSON.parse(match[0]) as Record<string, unknown>);
}

export async function locateInsideNeckLabelTargetByEdges(image: Buffer): Promise<NeckLabelTarget> {
  const raw = await sharp(image).rotate().resize({ width: 480, height: 720, fit: "inside", withoutEnlargement: false })
    .greyscale().blur(0.6).raw().toBuffer({ resolveWithObject: true });
  const { width, height } = raw.info;
  const gradient = new Float32Array(width * height);
  let gradientTotal = 0;
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const index = y * width + x;
      const dx = raw.data[index + 1] - raw.data[index - 1];
      const dy = raw.data[index + width] - raw.data[index - width];
      const value = Math.hypot(dx, dy);
      gradient[index] = value;
      gradientTotal += value;
    }
  }
  const globalGradient = gradientTotal / Math.max(1, (width - 2) * (height - 2));
  const backgroundLuminance = cornerLuminance(raw.data, width, height);
  let best: { score: number; centerX: number; centerY: number; radiusX: number; rotationDeg: number } | undefined;
  for (let centerY = Math.round(height * 0.14); centerY <= height * 0.34; centerY += 6) {
    // Approved CRM front scenes keep the collar in the central/right torso
    // band. Excluding the outer shoulder band prevents quilt seams and sleeve
    // hems from masquerading as a crew-neck ellipse.
    for (let centerX = Math.round(width * 0.54); centerX <= width * 0.78; centerX += 6) {
      const garmentContrast = Math.abs(meanLuminance(raw.data, width, height, centerX, centerY, 8) - backgroundLuminance);
      if (garmentContrast < 35) continue;
      for (const radiusX of [0.065, 0.08, 0.095, 0.11, 0.125].map((ratio) => width * ratio)) {
        for (const radiusY of [0.032, 0.044, 0.056, 0.068].map((ratio) => height * ratio)) {
          if (garmentCoverage(raw.data, width, height, centerX, centerY, radiusX, radiusY, backgroundLuminance) < 0.72) continue;
          for (const rotationDeg of [-14, -7, 0, 7, 14]) {
            const outer = ellipseGradientScore(gradient, width, height, centerX, centerY, radiusX, radiusY, rotationDeg);
            const inner = ellipseGradientScore(gradient, width, height, centerX, centerY, radiusX * 0.78, radiusY * 0.72, rotationDeg);
            const contourScore = Math.min(outer, inner) * 0.72 + Math.max(outer, inner) * 0.28;
            const score = contourScore * (1 + Math.min(1.2, garmentContrast / 90));
            if (!best || score > best.score) best = { score, centerX, centerY, radiusX, rotationDeg };
          }
        }
      }
    }
  }
  const strength = (best?.score || 0) / Math.max(1, globalGradient);
  if (!best || strength < 1.55) throw new Error("a reliable double collar contour was not found");
  const detectedCenterX = best.centerX / width;
  return {
    // The oblique approved packshot can make one side of the rib stronger than
    // the other. Pull the contour estimate toward the known torso centre so
    // the mark lands on the rear panel, not on either rib edge.
    centerX: detectedCenterX * 0.62 + 0.56 * 0.38,
    centerY: best.centerY / height,
    widthRatio: Math.max(0.04, Math.min(0.095, best.radiusX * 0.58 / width)),
    rotationDeg: Math.max(-7, Math.min(7, best.rotationDeg)),
    confidence: Math.max(0.75, Math.min(0.94, 0.7 + (strength - 1.4) * 0.12)),
  };
}

function garmentCoverage(
  data: Buffer,
  width: number,
  height: number,
  centerX: number,
  centerY: number,
  radiusX: number,
  radiusY: number,
  background: number,
) {
  let garment = 0;
  let count = 0;
  for (const xRatio of [-0.8, -0.4, 0, 0.4, 0.8]) {
    for (const yRatio of [-0.7, -0.35, 0, 0.35, 0.7]) {
      if (xRatio * xRatio + yRatio * yRatio > 1) continue;
      const x = Math.max(0, Math.min(width - 1, Math.round(centerX + radiusX * xRatio)));
      const y = Math.max(0, Math.min(height - 1, Math.round(centerY + radiusY * yRatio)));
      if (Math.abs(data[y * width + x] - background) >= 35) garment += 1;
      count += 1;
    }
  }
  return count ? garment / count : 0;
}

function cornerLuminance(data: Buffer, width: number, height: number) {
  return [
    meanLuminance(data, width, height, width * 0.05, height * 0.05, 12),
    meanLuminance(data, width, height, width * 0.95, height * 0.05, 12),
    meanLuminance(data, width, height, width * 0.05, height * 0.95, 12),
    meanLuminance(data, width, height, width * 0.95, height * 0.95, 12),
  ].sort((left, right) => left - right)[2];
}

function meanLuminance(data: Buffer, width: number, height: number, centerX: number, centerY: number, radius: number) {
  const left = Math.max(0, Math.round(centerX - radius));
  const right = Math.min(width - 1, Math.round(centerX + radius));
  const top = Math.max(0, Math.round(centerY - radius));
  const bottom = Math.min(height - 1, Math.round(centerY + radius));
  let total = 0;
  let count = 0;
  for (let y = top; y <= bottom; y += 2) {
    for (let x = left; x <= right; x += 2) {
      total += data[y * width + x];
      count += 1;
    }
  }
  return count ? total / count : 0;
}

function ellipseGradientScore(
  gradient: Float32Array,
  width: number,
  height: number,
  centerX: number,
  centerY: number,
  radiusX: number,
  radiusY: number,
  rotationDeg: number,
) {
  const rotation = rotationDeg * Math.PI / 180;
  const cosR = Math.cos(rotation);
  const sinR = Math.sin(rotation);
  let total = 0;
  let count = 0;
  for (let index = 0; index < 48; index += 1) {
    const angle = index * Math.PI * 2 / 48;
    const ellipseX = radiusX * Math.cos(angle);
    const ellipseY = radiusY * Math.sin(angle);
    const x = Math.round(centerX + ellipseX * cosR - ellipseY * sinR);
    const y = Math.round(centerY + ellipseX * sinR + ellipseY * cosR);
    if (x < 1 || x >= width - 1 || y < 1 || y >= height - 1) continue;
    total += gradient[y * width + x];
    count += 1;
  }
  return count ? total / count : 0;
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
