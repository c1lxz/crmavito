import { randomBytes } from "node:crypto";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { BACKGROUND_SLOTS, readBackground, validateImageFile, type BackgroundSlot } from "@/lib/ai/content-machine";
import {
  closestKlingAspectRatio,
  createKlingImageTask,
  getKlingImageTask,
  KLING_PRODUCT_PHOTO_PROMPT,
  type KlingAspectRatio,
} from "@/lib/ai/kling-images";

type StoredProduct = { index: number; originalName: string; fileName: string };
type KlingWorkItem = {
  productIndex: number;
  backgroundSlot: BackgroundSlot;
  taskId?: string;
  status: "submitting" | "submitted" | "processing" | "ready" | "failed";
  error?: string;
  resultFileName?: string;
};
type KlingManifest = {
  id: string;
  createdAt: string;
  imageSize: "2K" | "4K";
  model: string;
  generationPrompt: string;
  products: StoredProduct[];
  tasks: KlingWorkItem[];
};

export type KlingJobResult = {
  id: string;
  productIndex: number;
  productName: string;
  backgroundSlot: BackgroundSlot;
  fileName: string;
  mimeType: string;
  size: number;
  url: string;
};

export type KlingContentMachineJob = KlingManifest & {
  status: "waiting" | "partial" | "ready" | "failed";
  expectedResults: number;
  failedResults: number;
  results: KlingJobResult[];
};

function jobsDirectory() {
  return process.env.CONTENT_MACHINE_DATA_DIR?.trim()
    ? path.resolve(process.env.CONTENT_MACHINE_DATA_DIR, "kling-jobs")
    : path.join(process.cwd(), "data", "content-machine", "kling-jobs");
}

function assertJobId(id: string) {
  if (!/^KL-[0-9]{8}-[A-Z0-9]{6}$/.test(id)) throw new Error("Некорректный код задания Kling.");
}

function jobDirectory(id: string) {
  assertJobId(id);
  return path.join(jobsDirectory(), id);
}

async function saveManifest(manifest: KlingManifest) {
  const directory = jobDirectory(manifest.id);
  const temporary = path.join(directory, ".manifest.json");
  await writeFile(temporary, JSON.stringify(manifest, null, 2), "utf8");
  await rename(temporary, path.join(directory, "manifest.json"));
}

export async function createKlingContentMachineJob(products: File[], imageSize: "2K" | "4K") {
  if (products.length < 1 || products.length > 10) throw new Error("Добавьте от 1 до 10 фотографий товара.");
  products.forEach(validateImageFile);
  if (!process.env.KLING_API_KEY?.trim()) throw new Error("Не задан KLING_API_KEY.");

  const now = new Date();
  const id = `KL-${now.toISOString().slice(0, 10).replaceAll("-", "")}-${randomBytes(3).toString("hex").toUpperCase()}`;
  const directory = jobDirectory(id);
  await Promise.all([
    mkdir(path.join(directory, "products"), { recursive: true }),
    mkdir(path.join(directory, "backgrounds"), { recursive: true }),
    mkdir(path.join(directory, "results"), { recursive: true }),
  ]);

  const storedProducts: StoredProduct[] = [];
  const productReferences = new Map<number, string>();
  for (const [offset, product] of products.entries()) {
    const index = offset + 1;
    const fileName = `product-${String(index).padStart(2, "0")}.jpg`;
    const normalized = await normalizeForKling(Buffer.from(await product.arrayBuffer()));
    await writeFile(path.join(directory, "products", fileName), normalized.buffer);
    storedProducts.push({ index, originalName: product.name, fileName });
    productReferences.set(index, normalized.buffer.toString("base64"));
  }

  const backgroundReferences = new Map<BackgroundSlot, { image: string; aspectRatio: KlingAspectRatio }>();
  for (const slot of BACKGROUND_SLOTS) {
    const background = await readBackground(slot);
    const normalized = await normalizeForKling(background.buffer);
    await writeFile(path.join(directory, "backgrounds", `background-${slot}.jpg`), normalized.buffer);
    backgroundReferences.set(slot, {
      image: normalized.buffer.toString("base64"),
      aspectRatio: closestKlingAspectRatio(normalized.width, normalized.height),
    });
  }

  const manifest: KlingManifest = {
    id,
    createdAt: now.toISOString(),
    imageSize,
    model: process.env.KLING_IMAGE_MODEL?.trim() || "kling-v3-omni",
    generationPrompt: KLING_PRODUCT_PHOTO_PROMPT,
    products: storedProducts,
    tasks: storedProducts.flatMap((product) =>
      BACKGROUND_SLOTS.map((backgroundSlot) => ({ productIndex: product.index, backgroundSlot, status: "submitting" as const }))),
  };
  await saveManifest(manifest);

  let fatalSubmissionError: string | null = null;
  for (const task of manifest.tasks) {
    if (fatalSubmissionError) {
      task.status = "failed";
      task.error = fatalSubmissionError;
      continue;
    }
    try {
      const background = backgroundReferences.get(task.backgroundSlot);
      const product = productReferences.get(task.productIndex);
      if (!background || !product) throw new Error("Не найдены подготовленные референсы.");
      const remote = await createKlingImageTask({
        images: [product, background.image],
        resolution: imageSize === "4K" ? "4k" : "2k",
        aspectRatio: background.aspectRatio,
        externalTaskId: `${id}-${String(task.productIndex).padStart(2, "0")}-${task.backgroundSlot}`,
      });
      task.taskId = remote.task_id;
      task.status = remote.task_status === "processing" ? "processing" : "submitted";
    } catch (error) {
      task.status = "failed";
      task.error = error instanceof Error ? error.message : String(error);
      if (/balance not enough|unauthorized|invalid api key/i.test(task.error)) fatalSubmissionError = task.error;
    }
    await saveManifest(manifest);
  }
  if (fatalSubmissionError) await saveManifest(manifest);
  return hydrateJob(manifest);
}

export async function getKlingContentMachineJob(id: string) {
  const manifest = JSON.parse(await readFile(path.join(jobDirectory(id), "manifest.json"), "utf8")) as KlingManifest;
  const pending = manifest.tasks.filter((task) => task.taskId && (task.status === "submitted" || task.status === "processing"));
  await Promise.all(pending.map(async (task) => {
    try {
      const remote = await getKlingImageTask(task.taskId!);
      if (remote.task_status === "failed") {
        task.status = "failed";
        task.error = remote.task_status_msg || "Kling не смог сгенерировать изображение.";
        return;
      }
      if (remote.task_status !== "succeed") {
        task.status = remote.task_status === "processing" ? "processing" : "submitted";
        return;
      }
      const resultUrl = remote.task_result?.images?.[0]?.url || remote.task_result?.series_images?.[0]?.url;
      if (!resultUrl) throw new Error("Kling завершил задание без ссылки на результат.");
      const resultResponse = await fetch(resultUrl, { cache: "no-store" });
      if (!resultResponse.ok) throw new Error(`Не удалось скачать результат Kling: HTTP ${resultResponse.status}`);
      const fileName = `product-${String(task.productIndex).padStart(2, "0")}-background-${task.backgroundSlot}.png`;
      await writeFile(path.join(jobDirectory(id), "results", fileName), Buffer.from(await resultResponse.arrayBuffer()));
      task.resultFileName = fileName;
      task.status = "ready";
      delete task.error;
    } catch (error) {
      task.status = "failed";
      task.error = error instanceof Error ? error.message : String(error);
    }
  }));
  if (pending.length) await saveManifest(manifest);
  return hydrateJob(manifest);
}

async function hydrateJob(manifest: KlingManifest): Promise<KlingContentMachineJob> {
  const results: KlingJobResult[] = [];
  for (const task of manifest.tasks) {
    if (task.status !== "ready" || !task.resultFileName) continue;
    const product = manifest.products.find((item) => item.index === task.productIndex);
    if (!product) continue;
    const details = await stat(path.join(jobDirectory(manifest.id), "results", task.resultFileName));
    results.push({
      id: `${task.productIndex}:${task.backgroundSlot}`,
      productIndex: task.productIndex,
      productName: product.originalName,
      backgroundSlot: task.backgroundSlot,
      fileName: task.resultFileName,
      mimeType: "image/png",
      size: details.size,
      url: `/api/ai/content-machine/kling-jobs/${manifest.id}/files/results/${encodeURIComponent(task.resultFileName)}?v=${details.mtimeMs}`,
    });
  }
  const failedResults = manifest.tasks.filter((task) => task.status === "failed").length;
  const expectedResults = manifest.tasks.length;
  const finished = results.length + failedResults;
  const status = results.length === expectedResults
    ? "ready"
    : finished === expectedResults && failedResults > 0
      ? "failed"
      : results.length > 0
        ? "partial"
        : "waiting";
  return { ...manifest, status, expectedResults, failedResults, results };
}

export async function readKlingJobFile(id: string, kind: string, fileName: string) {
  if (!(["products", "backgrounds", "results"] as const).includes(kind as "products" | "backgrounds" | "results")) {
    throw new Error("Некорректный тип файла.");
  }
  if (path.basename(fileName) !== fileName || !/^[a-zA-Z0-9._-]+$/.test(fileName)) throw new Error("Некорректное имя файла.");
  const buffer = await readFile(path.join(jobDirectory(id), kind, fileName));
  return { buffer, mimeType: path.extname(fileName).toLowerCase() === ".png" ? "image/png" : "image/jpeg" };
}

async function normalizeForKling(input: Buffer) {
  const image = sharp(input).rotate().flatten({ background: "#ffffff" }).resize({
    width: 2560,
    height: 2560,
    fit: "inside",
    withoutEnlargement: false,
  });
  const buffer = await image.jpeg({ quality: 90, mozjpeg: true }).toBuffer();
  if (buffer.length > 10 * 1024 * 1024) throw new Error("Изображение не удалось подготовить к лимиту Kling 10 МБ.");
  const metadata = await sharp(buffer).metadata();
  return { buffer, width: metadata.width, height: metadata.height };
}
