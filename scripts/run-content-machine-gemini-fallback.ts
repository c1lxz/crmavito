import { hostname } from "node:os";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadEnvConfig } from "@next/env";
import { chromium } from "playwright";
import sharp from "sharp";
import { generateGeminiImage, type GeminiReferenceImage } from "../lib/ai/gemini-images";
import { createKlingImageTask, getKlingImageTask, type KlingAspectRatio } from "../lib/ai/kling-images";
import { createGeminiApparelDesignPrompt } from "../lib/flow-agent/design-brief";
import { applyExactLabelOverlay, createBestLabelAssets } from "../lib/flow-agent/label-lock";
import { buildOriginalStagePrompt, type OriginalDesignStage } from "../lib/flow-agent/original-design";
import { browserPageFetch } from "../lib/flow-agent/quality";
import { compactFlowPrompt } from "../lib/flow-agent/browser";
import type { MarketResearch } from "../lib/flow-agent/market-research";

loadEnvConfig(process.cwd());

type BackgroundSlot = "1" | "2" | "3" | "4";
type AgentJob = {
  id: string;
  imageSize: "2K" | "4K";
  generationPrompt?: string;
  mode?: "product-photo" | "original-design";
  inspirationQuery?: string;
  designNote?: string;
  labelStyleReference?: string;
  preserveWinnerLabel?: boolean;
  marketResearch?: MarketResearch;
  products: Array<{ index: number; fileName: string; mimeType: string }>;
  backgrounds: Array<{ slot: BackgroundSlot; fileName: string; mimeType: string }>;
  results: Array<{ productIndex: number; backgroundSlot: BackgroundSlot; fileName?: string }>;
};

const expectedJobId = process.argv[2]?.trim();
if (!expectedJobId) throw new Error("Usage: tsx scripts/run-content-machine-gemini-fallback.ts <job-id>");
const baseUrl = (process.env.FLOW_AGENT_CRM_URL || "https://crmavito.duckdns.org").replace(/\/+$/, "");
const token = process.env.FLOW_LOCAL_AGENT_TOKEN?.trim() || "";
const agentId = `gemini-api-${hostname()}-${process.pid}`;
const cdpUrl = process.env.FLOW_AGENT_CDP_URL?.trim() || "http://127.0.0.1:9223";

async function main() {
  if (!token) throw new Error("FLOW_LOCAL_AGENT_TOKEN is not configured.");
  const job = await claimJob();
  if (!job || job.id !== expectedJobId) throw new Error(`Expected ${expectedJobId}, got ${job?.id || "none"}.`);
  if (job.mode !== "original-design") throw new Error("Gemini API fallback supports original-design jobs only.");

  const workDirectory = path.join(os.tmpdir(), `content-machine-gemini-${job.id}`);
  await rm(workDirectory, { recursive: true, force: true });
  await mkdir(workDirectory, { recursive: true });
  const browser = await chromium.connectOverCDP(cdpUrl);
  try {
    const context = browser.contexts()[0];
    const page = context.pages()[0] || await context.newPage();
    const proxyFetch = browserPageFetch(page);
    const products = await Promise.all(job.products.map(async (product) => {
      const filePath = path.join(workDirectory, product.fileName);
      await downloadAsset(job.id, "products", product.fileName, filePath);
      return { ...product, filePath, buffer: await readFile(filePath) };
    }));
    const backgrounds = new Map(await Promise.all(job.backgrounds.map(async (background) => {
      const filePath = path.join(workDirectory, background.fileName);
      await downloadAsset(job.id, "backgrounds", background.fileName, filePath);
      return [background.slot, { ...background, filePath, buffer: await readFile(filePath) }] as const;
    })));

    let labelOverlayPath: string | undefined;
    if (job.preserveWinnerLabel) {
      labelOverlayPath = path.join(workDirectory, "winner-label.png");
      await createBestLabelAssets(products.map((product) => product.filePath), path.join(workDirectory, "winner-label-reference.png"), labelOverlayPath);
    }

    const research = job.marketResearch || {
      query: job.inspirationQuery || "archive designer t-shirt",
      checkedAt: new Date().toISOString(),
      listings: [],
      topSignals: ["restrained front hook", "distinct back hero", "compact printable artwork"],
      sourceCounts: { grailed: 0, mercari: 0, rakuma: 0 },
    };
    let basePrompt: string;
    try {
      const generatedBrief = await createGeminiApparelDesignPrompt({
        sourcePaths: products.map((product) => product.filePath),
        research,
        designNote: job.designNote,
        labelStyleReference: job.labelStyleReference,
      }, { fetchFn: proxyFetch });
      basePrompt = generatedBrief.prompt;
    } catch (error) {
      console.warn(`[gemini-api] design director unavailable, using deterministic analytics brief: ${error instanceof Error ? error.message : error}`);
      basePrompt = `${job.generationPrompt || "Create a photorealistic marketplace t-shirt photo."}\nDESIGN BRIEF: ${job.designNote || job.inspirationQuery || "Create an original high-demand archive-inspired t-shirt design."}`;
    }
    if (job.preserveWinnerLabel) {
      basePrompt = basePrompt.replace(/LABEL CONSTRUCTION LOCK:[^.]*\.[^.]*\.[^.]*\./, "WINNER LABEL LOCK: preserve the exact internal neck marking from the source winner only on the inside back-neck panel; never invent it or relocate it onto an exterior surface.");
    }

    const anchors = new Map<"front" | "back", Buffer>();
    const completed = new Set(job.results.map((result) => result.backgroundSlot));
    for (const [slot, stage] of [["1", "front-anchor"], ["2", "back-anchor"], ["3", "front-detail"], ["4", "back-photo"]] as const) {
      if (completed.has(slot)) continue;
      const background = backgrounds.get(slot)!;
      const metadata = await sharp(background.buffer).metadata();
      const anchorSide = stage === "back-photo" ? "back" : "front";
      const references: GeminiReferenceImage[] = stage === "front-anchor"
        ? [asReference(background)]
        : [{ data: anchors.get(anchorSide)!.toString("base64"), mimeType: "image/jpeg" }, asReference(background)];
      const stagePrompt = buildOriginalStagePrompt(
        stage as OriginalDesignStage,
        basePrompt,
        stage === "front-anchor" ? 0 : 1,
        { preserveWinnerLabel: job.preserveWinnerLabel },
      );
      const prompt = stage === "front-anchor" ? compactFlowPrompt(stagePrompt) : stagePrompt;
      const startedAt = new Date().toISOString();
      const started = Date.now();
      console.log(`[gemini-api] ${job.id} ${slot}/4 ${stage}`);
      let generated: { data: string };
      try {
        generated = await generateGeminiImage({
          prompt,
          referenceImages: references,
          aspectRatio: closestAspectRatio(metadata.width, metadata.height),
          imageSize: job.imageSize,
        }, { fetchFn: proxyFetch });
      } catch (error) {
        console.warn(`[gemini-api] image quota unavailable, switching ${slot}/4 to Kling: ${error instanceof Error ? error.message : error}`);
        generated = await generateKlingStage({
          prompt,
          references,
          imageSize: job.imageSize,
          aspectRatio: closestAspectRatio(metadata.width, metadata.height),
          externalTaskId: `${job.id}-${slot}-${Date.now()}`,
        });
      }
      const outputPath = path.join(workDirectory, `result-${slot}.jpg`);
      await sharp(Buffer.from(generated.data, "base64")).rotate().jpeg({ quality: 96, chromaSubsampling: "4:4:4" }).toFile(outputPath);
      if (labelOverlayPath && (stage === "front-anchor" || stage === "front-detail")) await applyExactLabelOverlay(outputPath, labelOverlayPath);
      const output = await readFile(outputPath);
      if (stage === "front-anchor") anchors.set("front", output);
      if (stage === "back-anchor") anchors.set("back", output);
      await uploadResult(job.id, slot, outputPath, { startedAt, durationMs: Date.now() - started, generationMs: Date.now() - started });
    }
    console.log(JSON.stringify({ jobId: job.id, status: "complete" }));
  } catch (error) {
    await releaseJob(job.id, error instanceof Error ? error.message : String(error)).catch(() => undefined);
    throw error;
  } finally {
    // This process attaches to the user's already authenticated Chrome. Let the
    // process disconnect naturally; browser.close() would destroy that session.
    await rm(workDirectory, { recursive: true, force: true });
  }
}

function asReference(input: { buffer: Buffer; mimeType: string }): GeminiReferenceImage {
  return { data: input.buffer.toString("base64"), mimeType: input.mimeType as GeminiReferenceImage["mimeType"] };
}

async function claimJob(): Promise<AgentJob | null> {
  const response = await agentFetch("/api/ai/content-machine/flow-agent/jobs/next", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ agentId }) });
  const data = await response.json() as { job?: AgentJob | null; error?: string };
  if (!response.ok) throw new Error(data.error || `CRM HTTP ${response.status}`);
  return data.job || null;
}

async function downloadAsset(jobId: string, kind: string, fileName: string, target: string) {
  const response = await agentFetch(`/api/ai/content-machine/flow-agent/jobs/${jobId}/asset/${kind}/${encodeURIComponent(fileName)}`);
  if (!response.ok) throw new Error(`Asset ${fileName}: CRM HTTP ${response.status}`);
  await writeFile(target, Buffer.from(await response.arrayBuffer()));
}

async function uploadResult(jobId: string, slot: BackgroundSlot, filePath: string, timing: { startedAt: string; durationMs: number; generationMs: number }) {
  const form = new FormData();
  form.set("agentId", agentId);
  form.set("productIndex", "1");
  form.set("backgroundSlot", slot);
  form.set("startedAt", timing.startedAt);
  form.set("durationMs", String(timing.durationMs));
  form.set("uploadMs", "0");
  form.set("generationMs", String(timing.generationMs));
  const source = await readFile(filePath);
  form.set("file", new Blob([new Uint8Array(source)], { type: "image/jpeg" }), path.basename(filePath));
  const response = await agentFetch(`/api/ai/content-machine/flow-agent/jobs/${jobId}/result`, { method: "POST", body: form });
  if (!response.ok) throw new Error(`Result ${slot}: CRM HTTP ${response.status} ${await response.text()}`);
}

async function releaseJob(jobId: string, error: string) {
  await agentFetch(`/api/ai/content-machine/flow-agent/jobs/${jobId}/release`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ agentId, error }) });
}

function agentFetch(route: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${token}`);
  return fetch(`${baseUrl}${route}`, { ...init, headers, signal: AbortSignal.timeout(180_000) });
}

function closestAspectRatio(width?: number, height?: number) {
  if (!width || !height) return "1:1" as const;
  const ratio = width / height;
  const options = [["1:1", 1], ["3:2", 3 / 2], ["2:3", 2 / 3], ["3:4", 3 / 4], ["4:3", 4 / 3], ["4:5", 4 / 5], ["5:4", 5 / 4], ["9:16", 9 / 16], ["16:9", 16 / 9], ["21:9", 21 / 9]] as const;
  return options.reduce((best, option) => Math.abs(option[1] - ratio) < Math.abs(best[1] - ratio) ? option : best)[0];
}

async function generateKlingStage(input: {
  prompt: string;
  references: GeminiReferenceImage[];
  imageSize: "2K" | "4K";
  aspectRatio: string;
  externalTaskId: string;
}) {
  const supported = new Set(["16:9", "9:16", "1:1", "4:3", "3:4", "3:2", "2:3", "21:9"]);
  const task = await createKlingImageTask({
    images: input.references.map((reference) => reference.data),
    resolution: input.imageSize === "4K" ? "4k" : "2k",
    aspectRatio: (supported.has(input.aspectRatio) ? input.aspectRatio : "1:1") as KlingAspectRatio,
    externalTaskId: input.externalTaskId,
    prompt: input.prompt.length <= 2_500
      ? input.prompt
      : `${input.prompt.slice(0, 1_850)}\n${input.prompt.slice(-600)}`,
  });
  for (let attempt = 0; attempt < 90; attempt += 1) {
    const current = attempt === 0 ? task : await getKlingImageTask(task.task_id);
    if (current.task_status === "failed") throw new Error(current.task_status_msg || "Kling image generation failed.");
    if (current.task_status === "succeed") {
      const url = current.task_result?.images?.[0]?.url || current.task_result?.series_images?.[0]?.url;
      if (!url) throw new Error("Kling completed without an image URL.");
      const response = await fetch(url, { signal: AbortSignal.timeout(180_000) });
      if (!response.ok) throw new Error(`Kling result HTTP ${response.status}`);
      return { data: Buffer.from(await response.arrayBuffer()).toString("base64") };
    }
    await new Promise((resolve) => setTimeout(resolve, 8_000));
  }
  throw new Error("Kling image generation timed out.");
}

void main().then(
  () => process.exit(0),
  (error) => {
    console.error(error);
    process.exit(1);
  },
);
