import { z } from "zod";

const aspectRatios = ["1:1", "3:2", "2:3", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9"] as const;
const imageSizes = ["1K", "2K", "4K"] as const;

const geminiImageRequestSchema = z.object({
  prompt: z.string().trim().min(20).max(12000),
  aspectRatio: z.enum(aspectRatios).default("1:1"),
  imageSize: z.enum(imageSizes).default("2K"),
  referenceImages: z.array(z.object({
    data: z.string().min(8),
    mimeType: z.enum(["image/jpeg", "image/png", "image/webp"]),
  })).max(10).default([]),
});

export type GeminiImageRequest = z.input<typeof geminiImageRequestSchema>;
export type GeminiReferenceImage = { data: string; mimeType: "image/jpeg" | "image/png" | "image/webp" };

export function getGeminiImageStatus() {
  return {
    configured: Boolean(process.env.GEMINI_API_KEY?.trim()),
    model: process.env.GEMINI_IMAGE_MODEL?.trim() || "gemini-3.1-flash-image",
  };
}

export function buildProductPhotoPrompt(additionalInstructions?: string): string {
  const extra = additionalInstructions?.trim();
  return [
    "Create exactly ONE physically believable, photorealistic e-commerce product photograph from the two reference images. It must look like a real camera photo, never a render, collage or pasted cutout.",
    "REFERENCE IMAGE 1 is the PRODUCT PHOTO. REFERENCE IMAGE 2 is the ONLY ALLOWED BACKGROUND.",
    "The garment is an immutable product identity. Preserve it exactly: silhouette, cut, proportions, seams, stitching, fabric texture, folds, sleeves, collar, labels, wear, color, print artwork, every letter, font, spacing, print placement and print texture.",
    "You may improve the garment's placement, camera angle, crop and fold arrangement to create a natural professional flat-lay composition. Keep the same visible side (front or back) and never mirror the image or reveal, hide or invent product details.",
    "Do not redesign, retouch, simplify, repair, remove or add any part of the garment. A composition change must never change its product identity, construction or artwork.",
    "Replace only the original background. Use the actual texture and visual identity of REFERENCE IMAGE 2 across the entire background. Do not create a similar texture and do not introduce any other surface.",
    "The final frame must contain only the unchanged garment on that background. No props, hands, people, hangers, furniture, decorations, text overlays, borders, logos or objects not present in the references.",
    "Make the garment rest on the surface with believable weight and gravity. Preserve natural fabric thickness, fine weave, soft micro-wrinkles, fold compression and slight irregularities; do not make the fabric plastic, perfectly smooth or artificially sharpened.",
    "Infer the direction, softness, intensity and color temperature of the existing light from REFERENCE IMAGE 2 and apply that same light to the garment. Keep exposure, white balance, perspective, focus, depth of field and camera noise coherent across the whole frame.",
    "Ground every touching edge with physically correct shadows: a tight contact shadow at direct contact, soft ambient occlusion inside the collar, under sleeves, hems and overlapping folds, plus a faint broad cast shadow that becomes softer and lighter with distance. Shadows must follow the surface relief and one consistent light direction; never use a uniform dark outline.",
    "The surface must react to the garment naturally: subtle compression where the cloth rests, with background texture remaining visible and continuous elsewhere. No floating edges, cutout halo, glow, duplicated texture, synthetic blur or fake studio lighting.",
    "Match realistic scale and lens perspective. Retain modest real-camera imperfections and tonal variation so the result resembles a genuine marketplace photo rather than CGI or an over-retouched catalog mockup.",
    "Before output, visually compare the garment against REFERENCE IMAGE 1 and reject any internal attempt that changes print characters, construction details or garment geometry.",
    "Return only the final image.",
    extra ? `Additional constraint: ${extra}` : "",
  ].filter(Boolean).join("\n");
}

export function buildFlowProductPhotoPrompt(): string {
  return [
    "Create ONE natural photorealistic marketplace camera photo, never CGI/render/collage/cutout.",
    "IMAGE 1 = immutable product; IMAGE 2 = exact scene/surface/composition/light.",
    "Preserve exactly: silhouette, cut, seams, stitching, collar, sleeves, fabric, wear, color, every print line/letter/font/spacing/texture/placement. Same visible side; never mirror, redesign, add, remove or hide details.",
    "Only change placement, crop, camera angle and folds. Match IMAGE 2 perspective, scale, exposure, white balance, focus, depth of field and daylight.",
    "Show real weave, thickness, gravity, irregular wrinkles and surface compression; tight contact shadows, soft occlusion under collar/sleeves/hems/folds, faint cast shadow from one light.",
    "Use IMAGE 2 as the full background. No props, people, hands, hangers, overlays, halos, floating edges, plastic smoothing, studio light or watermarks. Return only final photo.",
  ].join(" ");
}

export async function generateGeminiImage(
  request: GeminiImageRequest,
  options: { fetchFn?: typeof fetch; apiKey?: string; model?: string; baseUrl?: string } = {},
): Promise<{ data: string; mimeType: string; model: string }> {
  const input = geminiImageRequestSchema.parse(request);
  const apiKey = options.apiKey?.trim() || process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) throw new Error("Gemini не настроен: добавьте GEMINI_API_KEY на сервере.");
  const model = options.model?.trim() || getGeminiImageStatus().model;
  const baseUrl = (options.baseUrl?.trim() || process.env.GEMINI_BASE_URL?.trim() || "https://generativelanguage.googleapis.com").replace(/\/$/, "");

  const response = await (options.fetchFn ?? fetch)(`${baseUrl}/v1beta/interactions`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
    body: JSON.stringify({
      model,
      input: [
        ...input.referenceImages.map((image) => ({ type: "image", data: image.data, mime_type: image.mimeType })),
        { type: "text", text: input.prompt },
      ],
      response_format: {
        type: "image",
        mime_type: "image/jpeg",
        aspect_ratio: input.aspectRatio,
        image_size: input.imageSize,
      },
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(300_000),
  });
  const raw = await response.text();
  const data = parseGeminiResponse(raw);
  if (!response.ok) {
    const message = data.error?.message || raw.trim() || "Не удалось создать изображение.";
    if (response.status === 429 && /quota|free_tier|billing/i.test(message)) {
      throw new Error("У ключа Gemini нет доступной квоты на генерацию изображений. Подключите биллинг к Google AI Studio / Google Cloud и повторите попытку.");
    }
    throw new Error(`Gemini API: HTTP ${response.status}. ${message}`);
  }
  if (!data.output_image?.data) throw new Error("Gemini не вернул изображение.");
  return { data: data.output_image.data, mimeType: data.output_image.mime_type || "image/jpeg", model };
}

function parseGeminiResponse(raw: string): {
  output_image?: { data?: string; mime_type?: string };
  error?: { message?: string };
} {
  try {
    return JSON.parse(raw) as {
      output_image?: { data?: string; mime_type?: string };
      error?: { message?: string };
    };
  } catch {
    return {};
  }
}
