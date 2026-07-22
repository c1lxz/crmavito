import { z } from "zod";

const geminiImageRequestSchema = z.object({
  prompt: z.string().trim().min(20).max(12000),
  aspectRatio: z.enum(["1:1", "3:2", "2:3", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9"]).default("1:1"),
  imageSize: z.enum(["1K", "2K", "4K"]).default("2K"),
});

export type GeminiImageRequest = z.input<typeof geminiImageRequestSchema>;

export function getGeminiImageStatus() {
  return {
    configured: Boolean(process.env.GEMINI_API_KEY?.trim()),
    model: process.env.GEMINI_IMAGE_MODEL?.trim() || "gemini-3.1-flash-image",
  };
}

export async function generateGeminiImage(
  request: GeminiImageRequest,
  options: { fetchFn?: typeof fetch; apiKey?: string; model?: string } = {},
): Promise<{ data: string; mimeType: string; model: string }> {
  const input = geminiImageRequestSchema.parse(request);
  const apiKey = options.apiKey?.trim() || process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) throw new Error("Gemini не настроен: добавьте GEMINI_API_KEY на сервере.");
  const model = options.model?.trim() || getGeminiImageStatus().model;

  const response = await (options.fetchFn ?? fetch)("https://generativelanguage.googleapis.com/v1beta/interactions", {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
    body: JSON.stringify({
      model,
      input: [{ type: "text", text: input.prompt }],
      response_format: {
        type: "image",
        mime_type: "image/png",
        aspect_ratio: input.aspectRatio,
        image_size: input.imageSize,
      },
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(180_000),
  });
  const data = await response.json().catch(() => ({})) as {
    output_image?: { data?: string; mime_type?: string };
    error?: { message?: string };
  };
  if (!response.ok) throw new Error(`Gemini API: HTTP ${response.status}. ${data.error?.message ?? "Не удалось создать изображение."}`);
  if (!data.output_image?.data) throw new Error("Gemini не вернул изображение.");
  return { data: data.output_image.data, mimeType: data.output_image.mime_type || "image/png", model };
}

