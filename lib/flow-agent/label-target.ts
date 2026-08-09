import sharp from "sharp";

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
  for (const candidateModel of models) {
    response = await fetchFn(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(candidateModel)}:generateContent`,
      {
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
      },
    );
    raw = await response.text();
    data = {};
    try { data = JSON.parse(raw) as GeminiResponse; } catch { /* handled below */ }
    if (response.ok || response.status !== 429) break;
  }
  if (!response?.ok) throw new Error(`Neck-panel locator: HTTP ${response?.status || 500}. ${data.error?.message || "Unavailable"}`);
  const text = data.candidates?.flatMap((candidate) => candidate.content?.parts || [])
    .map((part) => part.text || "").find(Boolean);
  const match = text?.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("Neck-panel locator returned invalid JSON.");
  const parsed = JSON.parse(match[0]) as Record<string, unknown>;
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
