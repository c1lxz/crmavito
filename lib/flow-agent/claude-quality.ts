import { getClaudeStatus } from "@/lib/ai/claude";
import { parseQualityVerdict, type FlowPhotoQualityVerdict } from "@/lib/flow-agent/quality";
import sharp from "sharp";

type AnthropicResponse = {
  content?: Array<{ type?: string; text?: string }>;
  error?: { message?: string } | string;
};

export async function evaluateFlowProductPhotoWithClaude(
  input: { product: Buffer; background: Buffer; candidate: Buffer },
  options: { fetchFn?: typeof fetch; apiKey?: string; baseUrl?: string; model?: string } = {},
): Promise<FlowPhotoQualityVerdict & { provider: "claude" }> {
  const apiKey = options.apiKey?.trim() || (process.env.CLAUDE_API_KEY || process.env.ANTHROPIC_API_KEY)?.trim();
  if (!apiKey) throw new Error("Claude QA не настроен на сервере.");
  const status = getClaudeStatus();
  const baseUrl = (options.baseUrl?.trim() || status.baseUrl).replace(/\/$/, "");
  const model = options.model?.trim() || status.model;
  const images = await Promise.all([input.product, input.background, input.candidate].map(async (image) => sharp(image)
    .rotate()
    .resize({ width: 1024, height: 1024, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 82, mozjpeg: true })
    .toBuffer()));
  const response = await (options.fetchFn ?? fetch)(`${baseUrl}/v1/messages`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "accept-encoding": "identity",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: 700,
      temperature: 0,
      messages: [{
        role: "user",
        content: [
          imagePart(images[0]),
          { type: "text", text: "IMAGE A — exact source product." },
          imagePart(images[1]),
          { type: "text", text: "IMAGE B — scene reference only; its garment and markings must not appear." },
          imagePart(images[2]),
          { type: "text", text: "IMAGE C — generated candidate to audit." },
          { type: "text", text: qualityPrompt() },
        ],
      }],
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(90_000),
  });
  const raw = await response.text();
  let data: AnthropicResponse = {};
  try {
    data = raw ? JSON.parse(raw) as AnthropicResponse : {};
  } catch {
    // The response error below includes a useful gateway excerpt.
  }
  if (!response.ok) {
    const detail = (typeof data.error === "string" ? data.error : data.error?.message) || raw.slice(0, 300);
    throw new Error(`Claude QA: HTTP ${response.status}. ${detail}`);
  }
  const text = data.content?.filter((block) => block.type === "text").map((block) => block.text || "").join("\n");
  if (!text) throw new Error("Claude QA не вернул оценку изображения.");
  return { ...parseQualityVerdict(text), provider: "claude" };
}

function imagePart(image: Buffer) {
  return {
    type: "image",
    source: { type: "base64", media_type: "image/jpeg", data: image.toString("base64") },
  };
}

function qualityPrompt() {
  return [
    "Act as a strict product identity and photorealism gate.",
    "Compare A and C exactly. Count every printed motif; compare outline/fill, color, scale, position, cut, seams, collar, sleeves and fabric.",
    "Transcribe all visible words, letters and neck-label marks in A and C. Reject any missing, added, changed, mirrored, hidden or illegible detail.",
    "Reject every hang tag, paper tag, sewn label, woven tab, white collar locator, plastic fastener, string or cropped tag fragment. A heat-transfer marking is permitted only inside the back-neck panel and must never appear on the outer chest or outer back.",
    "B supplies only surface, perspective and light. Reject any garment, artwork, label, logo, text or watermark copied from B.",
    "Reject CGI, pasted edges, floating cloth, broken geometry or duplicated details. Natural folds, crop, angle and lighting may differ.",
    "Return only JSON: {\"pass\":boolean,\"score\":integer 0..100,\"issues\":[short strings]}. Pass requires score >= 85 and exact product identity.",
  ].join(" ");
}
