import { getClaudeStatus } from "@/lib/ai/claude";
import type { MarketResearch } from "@/lib/flow-agent/market-research";
import sharp from "sharp";

type AnthropicResponse = {
  content?: Array<{ type?: string; text?: string }>;
  error?: { message?: string } | string;
};

export async function createClaudeDesignMetaPrompt(
  input: {
    images: Array<{
      image: Buffer;
      mimeType: "image/jpeg" | "image/png" | "image/webp";
    }>;
    query: string;
    designNote?: string;
    labelStyleReference?: string;
    research: MarketResearch;
  },
  options: { fetchFn?: typeof fetch; apiKey?: string; baseUrl?: string; model?: string } = {},
) {
  const apiKey = options.apiKey?.trim() || (process.env.CLAUDE_API_KEY || process.env.ANTHROPIC_API_KEY)?.trim();
  if (!apiKey) throw new Error("Claude не настроен на сервере.");
  if (input.images.length < 1 || input.images.length > 6) throw new Error("Claude нужно от 1 до 6 ракурсов одного товара.");
  const status = getClaudeStatus();
  const baseUrl = (options.baseUrl?.trim() || status.baseUrl).replace(/\/$/, "");
  const model = options.model?.trim() || status.model;
  const signals = input.research.topSignals.join(", ") || "no stable cross-market signals";
  const preparedImages = await Promise.all(input.images.map(async ({ image }) => sharp(image)
    .rotate()
    .resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true })
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
      max_tokens: 1200,
      messages: [{
        role: "user",
        content: [
          ...preparedImages.map((image) => ({
            type: "image",
            source: {
              type: "base64",
              media_type: "image/jpeg",
              data: image.toString("base64"),
            },
          })),
          {
            type: "text",
            text: buildMetaPromptRequest(input.query, signals, input.research.sourceCounts, input.images.length, input.designNote, input.labelStyleReference),
          },
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
    // Error handling below includes the raw gateway response.
  }
  if (!response.ok) {
    const detail = (typeof data.error === "string" ? data.error : data.error?.message) || raw.slice(0, 300);
    throw new Error(`Claude API: HTTP ${response.status}. ${detail}`);
  }
  const prompt = data.content
    ?.filter((block) => block.type === "text")
    .map((block) => block.text || "")
    .join("\n")
    .replace(/^```(?:text)?\s*|\s*```$/gi, "")
    .trim();
  if (!prompt || prompt.length < 300) throw new Error("Claude вернул слишком короткий мета-промпт.");
  return { prompt: prompt.slice(0, 900), model };
}

function buildMetaPromptRequest(
  query: string,
  signals: string,
  counts: MarketResearch["sourceCounts"],
  referenceCount: number,
  designNote?: string,
  labelStyleReference?: string,
) {
  return [
    "You are a senior apparel art director writing the final image-generation prompt for Google Flow.",
    `The ${referenceCount} uploaded images show different views and details of the same proven-performing T-shirt or long-sleeve. Analyze front, back, sleeves and detail shots together, including whether graphics exist on both sides.`,
    `The market query is: ${query}.`,
    `Cross-market abstract signals are: ${signals}.`,
    `Research coverage: Grailed ${counts.grailed}, Mercari ${counts.mercari}, Rakuma ${counts.rakuma}.`,
    designNote?.trim()
      ? `Mandatory user note for the final result:\n${designNote.trim()}\nTranslate this intent into precise visual and camera directions in the final Flow prompt. Follow it unless it conflicts with originality, safety or photorealistic quality.`
      : "There is no additional user note.",
    labelStyleReference?.trim()
      ? `Neck-label aesthetic reference: ${labelStyleReference.trim()}. Add exactly one small, single-line heat-transfer marking inside the back neck reading exactly "CUSTOM MADE". It must be ink printed directly on the fabric, never a sewn or woven tag, and must not be repeated or accompanied by any second line. Use only broad high-level aesthetic cues from the reference. Invent original typography and spacing; never render the reference name, its logo, monogram or distinctive trade dress.`
      : "Do not add neck-label text.",
    "Write one production-ready English Flow prompt of 650-850 characters that creates ONE genuinely original garment design and a premium photorealistic marketplace photo.",
    "The prompt must preserve the broad demand logic while changing all protected expression. Explicitly prohibit copying or closely imitating any brand, logo, character, mascot, artwork, artist style, monogram, exact wording or distinctive composition visible in the reference.",
    "Invent and explicitly describe a new central motif, supporting geometry, layout and limited color system that are visibly different from the uploaded winner.",
    "Demand crisp print edges, visible cotton weave, realistic screen-print ink absorption, sharp seams, natural folds and contact shadows, neutral white balance, high micro-contrast and a clean high-resolution commercial camera result.",
    "Prefer a purely visual main graphic. If typography is essential, specify one exact original phrase of at most three words in quotation marks. Prohibit all other words, letters, numbers and fake branding except the explicitly requested original CUSTOM MADE neck label.",
    `Flow receives REFERENCE IMAGES 1-${referenceCount} as views of the same inspiration garment and REFERENCE IMAGE ${referenceCount + 1} as the exact background, perspective and light reference. Tell Flow to understand the full front/back print system without copying its protected artwork.`,
    "When the uploaded views show graphics on both sides, require a coordinated but fully original front-and-back print system and distribute front, back and angled presentation across the three independent runs.",
    "The final prompt is reused for three independent Flow generations. Convert requests for several angles or variants into concise directions that encourage meaningful viewpoint variation across those independent runs; still request exactly one image per run.",
    "Avoid generic CGI, soft focus, low resolution, plastic fabric, pasted graphics, halos, malformed text, watermarks, props and extra garments.",
    "Do not explain your analysis and do not use Markdown. Return only the final Flow prompt.",
  ].join("\n");
}
