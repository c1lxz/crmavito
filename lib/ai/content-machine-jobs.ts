import { randomBytes } from "node:crypto";
import { mkdir, readFile, readdir, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { BACKGROUND_SLOTS, readBackground, validateImageFile, type BackgroundSlot } from "@/lib/ai/content-machine";
import { buildFlowProductPhotoPrompt } from "@/lib/ai/gemini-images";
import { publicFlowAgentError } from "@/lib/flow-agent/errors";
import type { MarketResearch } from "@/lib/flow-agent/market-research";

const mimeExtensions = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" } as const;
const resultMimeTypes: Record<string, string> = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp" };
let mutationQueue: Promise<unknown> = Promise.resolve();

type JobProduct = { index: number; originalName: string; fileName: string; mimeType: string };
type JobBackground = { slot: BackgroundSlot; originalName: string; fileName: string; mimeType: string };
type JobManifest = {
  id: string;
  createdAt: string;
  imageSize: "2K" | "4K";
  provider: "google-flow";
  agentStatus: "queued" | "processing" | "complete" | "failed";
  agentId?: string;
  claimedAt?: string;
  agentExclusions?: Record<string, string>;
  completedAt?: string;
  error?: string;
  metrics?: FlowJobMetrics;
  qualityProfile?: "photorealistic-v2" | "photorealistic-v3" | "photorealistic-v4";
  generationPrompt?: string;
  mode?: "product-photo" | "original-design";
  inspirationQuery?: string;
  designNote?: string;
  labelStyleReference?: string;
  preserveWinnerLabel?: boolean;
  marketResearch?: MarketResearch;
  designPrompt?: string;
  metaPromptSource?: "gemini" | "claude" | "fallback";
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
  status: "waiting" | "partial" | "ready" | "failed";
  expectedResults: number;
  results: CodexJobResult[];
  instruction: string;
};

export type FlowGenerationMetric = {
  productIndex: number;
  backgroundSlot: BackgroundSlot;
  startedAt: string;
  durationMs: number;
  uploadMs: number;
  generationMs: number;
};

export type FlowJobMetrics = {
  agentId: string;
  startedAt: string;
  completedAt?: string;
  totalDurationMs?: number;
  averageGenerationMs?: number;
  generations: FlowGenerationMetric[];
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

export async function createCodexJob(
  products: File[],
  imageSize: "2K" | "4K",
  options: {
    mode?: "product-photo" | "original-design";
    inspirationQuery?: string;
    designNote?: string;
    labelStyleReference?: string;
    preserveWinnerLabel?: boolean;
  } = {},
): Promise<CodexJob> {
  if (products.length < 1 || products.length > 10) throw new Error("Добавьте от 1 до 10 фотографий товара.");
  products.forEach(validateImageFile);
  const mode = options.mode === "original-design" ? "original-design" : "product-photo";
  const inspirationQuery = options.inspirationQuery?.trim().slice(0, 120);
  const designNote = options.designNote?.trim().slice(0, 1200);
  const labelStyleReference = options.labelStyleReference?.replace(/\s+/g, " ").trim().slice(0, 100);
  if (mode === "original-design" && products.length > 6) {
    throw new Error("Для нового дизайна загрузите не больше 6 ракурсов одной позиции.");
  }
  if (mode === "original-design" && (!inspirationQuery || inspirationQuery.length < 3)) {
    throw new Error("Для нового дизайна укажите, что искать на Grailed, Mercari и Rakuma.");
  }
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
    provider: "google-flow",
    agentStatus: "queued",
    qualityProfile: "photorealistic-v4",
    generationPrompt: buildFlowProductPhotoPrompt(),
    mode,
    ...(inspirationQuery ? { inspirationQuery } : {}),
    ...(mode === "original-design" && designNote ? { designNote } : {}),
    ...(mode === "original-design" && labelStyleReference ? { labelStyleReference } : {}),
    ...(mode === "original-design" && options.preserveWinnerLabel ? { preserveWinnerLabel: true } : {}),
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
    const match = fileName.match(/^product-(\d{2})-background-([1234])\.(jpg|jpeg|png|webp)$/i);
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
  const expectedResults = expectedResultCount(manifest);
  const status = results.length >= expectedResults
    ? "ready"
    : manifest.agentStatus === "failed"
      ? "failed"
      : results.length === 0
        ? "waiting"
        : "partial";
  return {
    ...manifest,
    status,
    expectedResults,
    results,
    instruction: `Обработай задание ${manifest.id} из контент-машины CRM`,
  };
}

export async function claimNextFlowJob(agentId: string): Promise<CodexJob | null> {
  return withMutation(async () => {
    await mkdir(jobsDirectory(), { recursive: true });
    const ids = (await readdir(jobsDirectory())).filter((id) => /^CM-[0-9]{8}-[A-Z0-9]{6}$/.test(id));
    const manifests = await Promise.all(ids.map(async (id) =>
      JSON.parse(await readFile(path.join(jobDirectory(id), "manifest.json"), "utf8")) as JobManifest,
    ));
    // A newly submitted job must not sit behind stale released QA runs merely
    // because its random id sorts later. This also makes recovery feel live:
    // the user's latest explicit request is claimed first.
    manifests.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
    for (const manifest of manifests) {
      const resumable = manifest.agentStatus === "processing" && manifest.agentId === agentId;
      if ((manifest.agentStatus === "queued" || resumable)
        && await countResultFiles(manifest) >= expectedResultCount(manifest)) {
        completeManifest(manifest);
        await saveManifest(manifest);
        continue;
      }
      if (manifest.agentStatus !== "queued" && !resumable) continue;
      const excludedUntil = manifest.agentExclusions?.[agentId];
      if (!resumable && excludedUntil && Date.parse(excludedUntil) > Date.now()) continue;
      if (!resumable) {
        const now = new Date().toISOString();
        manifest.agentStatus = "processing";
        manifest.agentId = agentId;
        manifest.claimedAt = now;
        manifest.metrics = { agentId, startedAt: now, generations: [] };
        await saveManifest(manifest);
      }
      return hydrateJob(manifest);
    }
    return null;
  });
}

export async function saveFlowJobResult(
  id: string,
  input: {
    agentId: string;
    productIndex: number;
    backgroundSlot: BackgroundSlot;
    file: File;
    metric: Omit<FlowGenerationMetric, "productIndex" | "backgroundSlot">;
  },
) {
  return withMutation(async () => {
    const manifest = await readManifest(id);
    if (manifest.agentStatus !== "processing" || manifest.agentId !== input.agentId) {
      throw new Error("Задание назначено другому локальному агенту.");
    }
    const product = manifest.products.find((item) => item.index === input.productIndex);
    if (!product) throw new Error("Некорректный номер исходного фото.");
    if (!BACKGROUND_SLOTS.includes(input.backgroundSlot)) throw new Error("Некорректный номер фона.");
    validateImageFile(input.file);
    const extension = mimeExtensions[input.file.type as keyof typeof mimeExtensions];
    const fileName = `product-${String(input.productIndex).padStart(2, "0")}-background-${input.backgroundSlot}.${extension}`;
    await writeFile(path.join(jobDirectory(id), "results", fileName), Buffer.from(await input.file.arrayBuffer()));
    const metric = { productIndex: input.productIndex, backgroundSlot: input.backgroundSlot, ...input.metric };
    manifest.metrics ??= { agentId: input.agentId, startedAt: manifest.claimedAt || new Date().toISOString(), generations: [] };
    manifest.metrics.generations = manifest.metrics.generations.filter(
      (item) => item.productIndex !== input.productIndex || item.backgroundSlot !== input.backgroundSlot,
    );
    manifest.metrics.generations.push(metric);
    if (await countResultFiles(manifest) >= expectedResultCount(manifest)) completeManifest(manifest);
    await saveManifest(manifest);
    return hydrateJob(manifest);
  });
}

export async function saveFlowJobResearch(id: string, agentId: string, marketResearch: MarketResearch) {
  return withMutation(async () => {
    const manifest = await readManifest(id);
    if (manifest.agentStatus !== "processing" || manifest.agentId !== agentId) {
      throw new Error("Задание назначено другому локальному агенту.");
    }
    manifest.marketResearch = marketResearch;
    await saveManifest(manifest);
    return hydrateJob(manifest);
  });
}

export async function getFlowDesignPromptContext(id: string, agentId: string) {
  const manifest = await readManifest(id);
  if (manifest.agentStatus !== "processing" || manifest.agentId !== agentId) {
    throw new Error("Задание назначено другому локальному агенту.");
  }
  if (manifest.mode !== "original-design" || !manifest.inspirationQuery || !manifest.marketResearch) {
    throw new Error("Для задания ещё не готово исследование рынка.");
  }
  const images = await Promise.all(manifest.products.map(async (product) => ({
    image: await readFile(path.join(jobDirectory(id), "products", product.fileName)),
    mimeType: product.mimeType as "image/jpeg" | "image/png" | "image/webp",
  })));
  return {
    images,
    query: manifest.inspirationQuery,
    designNote: manifest.designNote,
    labelStyleReference: manifest.labelStyleReference,
    research: manifest.marketResearch,
    designPrompt: manifest.designPrompt,
  };
}

export async function saveFlowDesignPrompt(
  id: string,
  agentId: string,
  designPrompt: string,
  source: "gemini" | "claude" | "fallback",
) {
  return withMutation(async () => {
    const manifest = await readManifest(id);
    if (manifest.agentStatus !== "processing" || manifest.agentId !== agentId) {
      throw new Error("Задание назначено другому локальному агенту.");
    }
    manifest.designPrompt = designPrompt.slice(0, 12_000);
    manifest.metaPromptSource = source;
    await saveManifest(manifest);
    return hydrateJob(manifest);
  });
}

export async function failFlowJob(id: string, agentId: string, error: string) {
  return withMutation(async () => {
    const manifest = await readManifest(id);
    if (manifest.agentId !== agentId) throw new Error("Задание назначено другому локальному агенту.");
    if (shouldReleaseFlowJob(error)) {
      releaseManifestFromAgent(manifest, agentId, error);
      await saveManifest(manifest);
      return hydrateJob(manifest);
    }
    manifest.agentStatus = "failed";
    manifest.error = publicFlowAgentError(error);
    manifest.completedAt = new Date().toISOString();
    if (manifest.metrics) {
      manifest.metrics.completedAt = manifest.completedAt;
      manifest.metrics.totalDurationMs = Date.parse(manifest.completedAt) - Date.parse(manifest.metrics.startedAt);
    }
    await saveManifest(manifest);
    return hydrateJob(manifest);
  });
}

async function readManifest(id: string) {
  return JSON.parse(await readFile(path.join(jobDirectory(id), "manifest.json"), "utf8")) as JobManifest;
}

async function saveManifest(manifest: JobManifest) {
  const manifestPath = path.join(jobDirectory(manifest.id), "manifest.json");
  const temporary = `${manifestPath}.${process.pid}.tmp`;
  await writeFile(temporary, JSON.stringify(manifest, null, 2), "utf8");
  await rename(temporary, manifestPath);
}

export async function releaseFlowJob(id: string, agentId: string, error: string) {
  return withMutation(async () => {
    const manifest = await readManifest(id);
    if (manifest.agentId !== agentId) throw new Error("Задание назначено другому локальному агенту.");
    releaseManifestFromAgent(manifest, agentId, error);
    await saveManifest(manifest);
    return hydrateJob(manifest);
  });
}

function shouldReleaseFlowJob(error: string) {
  return /регион|region|unsupported-country|требуется вход|auth_required|рабочая область не загрузилась|ERR_TUNNEL_CONNECTION_FAILED|proxy.*(?:failed|unavailable)|туннел/i.test(error);
}

function releaseManifestFromAgent(manifest: JobManifest, agentId: string, error: string) {
  manifest.agentStatus = "queued";
  manifest.agentExclusions ??= {};
  manifest.agentExclusions[agentId] = new Date(Date.now() + 10 * 60_000).toISOString();
  manifest.error = publicFlowAgentError(error);
  delete manifest.agentId;
  delete manifest.claimedAt;
  delete manifest.completedAt;
  delete manifest.metrics;
}

export async function retryFlowJob(id: string) {
  return withMutation(async () => {
    const manifest = await readManifest(id);
    if (await countResultFiles(manifest) >= expectedResultCount(manifest)) {
      completeManifest(manifest);
    } else {
      manifest.agentStatus = "queued";
      delete manifest.agentId;
      delete manifest.claimedAt;
      delete manifest.completedAt;
      delete manifest.error;
      delete manifest.metrics;
      delete manifest.agentExclusions;
    }
    await saveManifest(manifest);
    return hydrateJob(manifest);
  });
}

async function countResultFiles(manifest: JobManifest) {
  const names = await readdir(path.join(jobDirectory(manifest.id), "results")).catch(() => []);
  return names.filter((name) => /^product-\d{2}-background-[1234]\.(jpg|jpeg|png|webp)$/i.test(name)).length;
}

function expectedResultCount(manifest: JobManifest) {
  return (manifest.mode === "original-design" ? 1 : manifest.products.length) * manifest.backgrounds.length;
}

function completeManifest(manifest: JobManifest) {
  const completedAt = new Date().toISOString();
  manifest.agentStatus = "complete";
  manifest.completedAt = completedAt;
  delete manifest.error;
  if (!manifest.metrics) return;
  manifest.metrics.completedAt = completedAt;
  manifest.metrics.totalDurationMs = Date.parse(completedAt) - Date.parse(manifest.metrics.startedAt);
  if (manifest.metrics.generations.length) {
    manifest.metrics.averageGenerationMs = Math.round(
      manifest.metrics.generations.reduce((sum, item) => sum + item.durationMs, 0) / manifest.metrics.generations.length,
    );
  }
}

function withMutation<T>(operation: () => Promise<T>): Promise<T> {
  const result = mutationQueue.then(operation, operation);
  mutationQueue = result.then(() => undefined, () => undefined);
  return result;
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
