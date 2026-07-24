const DEFAULT_API_BASE_URL = "https://api-singapore.klingai.com";
const DEFAULT_MODEL = "kling-v3-omni";

type KlingEnvelope<T> = {
  code: number;
  message?: string;
  request_id?: string;
  data: T;
};

export type KlingTaskStatus = "submitted" | "processing" | "succeed" | "failed";

export type KlingImageTask = {
  task_id: string;
  task_status: KlingTaskStatus;
  task_status_msg?: string;
  task_result?: {
    images?: Array<{ index: number; url: string; watermark_url?: string }>;
    series_images?: Array<{ index: number; url: string; watermark_url?: string }>;
  };
};

export const KLING_PRODUCT_PHOTO_PROMPT = [
  "Create one photorealistic ecommerce product photo.",
  "Use <<<image_1>>> only as the exact source of the product identity.",
  "Use <<<image_2>>> as the exact approved background, composition, camera angle and lighting reference.",
  "Remove any product already visible in <<<image_2>>> and replace it with the product from <<<image_1>>> in the same natural position.",
  "Preserve the product's exact shape, proportions, construction, seams, print, logo, text, colors, texture and visible details.",
  "Match perspective, scale, white balance, light direction and depth of field to the approved background.",
  "Add a tight realistic contact shadow and natural occlusion so the product does not float.",
  "Do not add people, hands, props, labels, duplicate products, new text or new branding.",
].join(" ");

export async function createKlingImageTask(input: {
  images: string[];
  resolution: "2k" | "4k";
  aspectRatio: KlingAspectRatio;
  externalTaskId: string;
}) {
  return klingRequest<KlingImageTask>("/v1/images/omni-image", {
    method: "POST",
    body: JSON.stringify({
      model_name: process.env.KLING_IMAGE_MODEL?.trim() || DEFAULT_MODEL,
      prompt: KLING_PRODUCT_PHOTO_PROMPT,
      image_list: input.images.map((image) => ({ image })),
      resolution: input.resolution,
      result_type: "single",
      n: 1,
      aspect_ratio: input.aspectRatio,
      watermark_info: { enabled: false },
      external_task_id: input.externalTaskId,
    }),
  });
}

export async function getKlingImageTask(taskId: string) {
  if (!/^[a-zA-Z0-9_-]+$/.test(taskId)) throw new Error("Некорректный идентификатор задания Kling.");
  return klingRequest<KlingImageTask>(`/v1/images/omni-image/${encodeURIComponent(taskId)}`, { method: "GET" });
}

async function klingRequest<T>(pathname: string, init: RequestInit) {
  const apiKey = process.env.KLING_API_KEY?.trim();
  if (!apiKey) throw new Error("Не задан KLING_API_KEY. Добавьте API-ключ Kling в окружение сервера.");
  const baseUrl = process.env.KLING_API_BASE_URL?.trim() || DEFAULT_API_BASE_URL;
  const response = await fetch(`${baseUrl}${pathname}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      ...init.headers,
    },
    cache: "no-store",
  });
  const payload = await response.json().catch(() => null) as KlingEnvelope<T> | null;
  if (!response.ok || !payload || payload.code !== 0) {
    const message = payload?.message?.trim() || `HTTP ${response.status}`;
    throw new Error(`Kling API: ${message}`);
  }
  return payload.data;
}

export type KlingAspectRatio = "16:9" | "9:16" | "1:1" | "4:3" | "3:4" | "3:2" | "2:3" | "21:9";

export function closestKlingAspectRatio(width?: number, height?: number): KlingAspectRatio {
  if (!width || !height) return "1:1";
  const ratio = width / height;
  const options: Array<[KlingAspectRatio, number]> = [
    ["16:9", 16 / 9],
    ["9:16", 9 / 16],
    ["1:1", 1],
    ["4:3", 4 / 3],
    ["3:4", 3 / 4],
    ["3:2", 3 / 2],
    ["2:3", 2 / 3],
    ["21:9", 21 / 9],
  ];
  return options.reduce((best, option) =>
    Math.abs(option[1] - ratio) < Math.abs(best[1] - ratio) ? option : best)[0];
}
