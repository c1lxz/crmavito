import { randomBytes } from "node:crypto";
import { mkdir, readFile, readdir, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { BACKGROUND_SLOTS, readBackground, validateImageFile, type BackgroundSlot } from "@/lib/ai/content-machine";
import { buildProductPhotoPrompt } from "@/lib/ai/gemini-images";

const mimeExtensions = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" } as const;
const resultMimeTypes: Record<string, string> = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp" };

type JobProduct = { index: number; originalName: string; fileName: string; mimeType: string };
type JobBackground = { slot: BackgroundSlot; originalName: string; fileName: string; mimeType: string };
type JobManifest = {
  id: string;
  createdAt: string;
  imageSize: "2K" | "4K";
  qualityProfile?: "photorealistic-v2";
  generationPrompt?: string;
  products: JobProduct[];
  backgrounds: JobBackground[];
};

export type CodexJobResult = {
  id: string;
  productIndex: number;
  productName: string;
  backgroundSlot: BackgroundSlot;
  fileName: string;
  mimeType: string;
  size: number;
  url: string;
};

export type CodexJob = JobManifest & {
  status: "waiting" | "partial" | "ready";
  expectedResults: number;
  results: CodexJobResult[];
  instruction: string;
};

function jobsDirectory() {
  return process.env.CONTENT_MACHINE_DATA_DIR?.trim()
    ? path.resolve(process.env.CONTENT_MACHINE_DATA_DIR, "codex-jobs")
    : path.join(process.cwd(), "data", "content-machine", "codex-jobs");
}

function assertJobId(id: string) {
  if (!/^CM-[0-9]{8}-[A-Z0-9]{6}$/.test(id)) throw new Error("Некорректный код задания.");
}

function jobDirectory(id: string) {
  assertJobId(id);
  return path.join(jobsDirectory(), id);
}

export async function createCodexJob(products: File[], imageSize: "2K" | "4K"): Promise<CodexJob> {
  if (products.length < 1 || products.length > 10) throw new Error("Добавьте от 1 до 10 фотографий товара.");
  products.forEach(validateImageFile);
  const now = new Date();
  const id = `CM-${now.toISOString().slice(0, 10).replaceAll("-", "")}-${randomBytes(3).toString("hex").toUpperCase()}`;
  const directory = jobDirectory(id);
  await Promise.all([
    mkdir(path.join(directory, "products"), { recursive: true }),
    mkdir(path.join(directory, "backgrounds"), { recursive: true }),
    mkdir(path.join(directory, "results"), { recursive: true }),
  ]);

  const storedProducts: JobProduct[] = [];
  for (const [offset, product] of products.entries()) {
    const index = offset + 1;
    const extension = mimeExtensions[product.type as keyof typeof mimeExtensions];
    const fileName = `product-${String(index).padStart(2, "0")}.${extension}`;
    await writeFile(path.join(directory, "products", fileName), Buffer.from(await product.arrayBuffer()));
    storedProducts.push({ index, originalName: product.name, fileName, mimeType: product.type });
  }

  const storedBackgrounds: JobBackground[] = [];
  for (const slot of BACKGROUND_SLOTS) {
    const background = await readBackground(slot);
    const extension = mimeExtensions[background.mimeType];
    const fileName = `background-${slot}.${extension}`;
    await writeFile(path.join(directory, "backgrounds", fileName), background.buffer);
    storedBackgrounds.push({ slot, originalName: background.fileName, fileName, mimeType: background.mimeType });
  }

  const manifest: JobManifest = {
    id,
    createdAt: now.toISOString(),
    imageSize,
    qualityProfile: "photorealistic-v2",
    generationPrompt: buildProductPhotoPrompt(),
    products: storedProducts,
    backgrounds: storedBackgrounds,
  };
  const temporary = path.join(directory, ".manifest.json");
  await writeFile(temporary, JSON.stringify(manifest, null, 2), "utf8");
  await rename(temporary, path.join(directory, "manifest.json"));
  return hydrateJob(manifest);
}

export async function getCodexJob(id: string): Promise<CodexJob> {
  const manifest = JSON.parse(await readFile(path.join(jobDirectory(id), "manifest.json"), "utf8")) as JobManifest;
  return hydrateJob(manifest);
}

async function hydrateJob(manifest: JobManifest): Promise<CodexJob> {
  const resultDirectory = path.join(jobDirectory(manifest.id), "results");
  await mkdir(resultDirectory, { recursive: true });
  const names = await readdir(resultDirectory);
  const results: CodexJobResult[] = [];
  for (const fileName of names.sort()) {
    const match = fileName.match(/^product-(\d{2})-background-([123])\.(jpg|jpeg|png|webp)$/i);
    if (!match) continue;
    const productIndex = Number(match[1]);
    const product = manifest.products.find((item) => item.index === productIndex);
    if (!product) continue;
    const details = await stat(path.join(resultDirectory, fileName));
    const backgroundSlot = match[2] as BackgroundSlot;
    results.push({
      id: `${productIndex}:${backgroundSlot}`,
      productIndex,
      productName: product.originalName,
      backgroundSlot,
      fileName,
      mimeType: resultMimeTypes[match[3].toLowerCase()] || "image/jpeg",
      size: details.size,
      url: `/api/ai/content-machine/codex-jobs/${manifest.id}/files/results/${encodeURIComponent(fileName)}?v=${details.mtimeMs}`,
    });
  }
  const expectedResults = manifest.products.length * BACKGROUND_SLOTS.length;
  const status = results.length === 0 ? "waiting" : results.length >= expectedResults ? "ready" : "partial";
  return {
    ...manifest,
    status,
    expectedResults,
    results,
    instruction: `Обработай задание ${manifest.id} из контент-машины CRM`,
  };
}

export async function readCodexJobFile(id: string, kind: string, fileName: string) {
  if (!(["products", "backgrounds", "results"] as const).includes(kind as "products" | "backgrounds" | "results")) {
    throw new Error("Некорректный тип файла.");
  }
  if (path.basename(fileName) !== fileName || !/^[a-zA-Z0-9._-]+$/.test(fileName)) throw new Error("Некорректное имя файла.");
  const filePath = path.join(jobDirectory(id), kind, fileName);
  const buffer = await readFile(filePath);
  const extension = path.extname(fileName).slice(1).toLowerCase();
  return { buffer, mimeType: resultMimeTypes[extension] || "application/octet-stream" };
}
