import { hostname } from "node:os";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { loadEnvConfig } from "@next/env";
import { chromium } from "playwright";
import { generateFlowImage } from "../lib/flow-agent/browser";

loadEnvConfig(process.cwd());

type BackgroundSlot = "1" | "2" | "3";
type AgentJob = {
  id: string;
  generationPrompt?: string;
  products: Array<{ index: number; fileName: string }>;
  backgrounds: Array<{ slot: BackgroundSlot; fileName: string }>;
  results: Array<{ productIndex: number; backgroundSlot: BackgroundSlot }>;
};

const baseUrl = (process.env.FLOW_AGENT_CRM_URL || "https://crmavito.duckdns.org").replace(/\/+$/, "");
const token = process.env.FLOW_LOCAL_AGENT_TOKEN?.trim() || "";
const flowUrl = process.env.FLOW_URL || "https://labs.google/fx/tools/flow";
const agentId = process.env.FLOW_AGENT_ID || hostname();
const concurrency = clamp(Number(process.env.FLOW_AGENT_CONCURRENCY || 3), 1, 6);
const pollMs = clamp(Number(process.env.FLOW_AGENT_POLL_MS || 750), 250, 30_000);
const generationTimeoutMs = clamp(Number(process.env.FLOW_GENERATION_TIMEOUT_MS || 240_000), 30_000, 600_000);
const stateDirectory = path.resolve(process.env.FLOW_AGENT_STATE_DIR || ".flow-local-agent");
const profileDirectory = path.join(stateDirectory, "chrome-profile");
const workDirectory = path.join(stateDirectory, "work");

async function main() {
  if (!token) throw new Error("Задайте FLOW_LOCAL_AGENT_TOKEN.");
  await mkdir(workDirectory, { recursive: true });
  const context = await chromium.launchPersistentContext(profileDirectory, {
    channel: "chrome",
    headless: process.env.FLOW_AGENT_HEADLESS === "1",
    viewport: { width: 1440, height: 1000 },
    args: ["--disable-background-timer-throttling", "--disable-renderer-backgrounding"],
  });
  console.log(`[flow-agent] ${agentId}; параллельность ${concurrency}; CRM ${baseUrl}`);
  try {
    while (true) {
      let job: AgentJob | null;
      try {
        job = await claimJob();
      } catch (error) {
        console.error(`[flow-agent] CRM poll failed: ${error instanceof Error ? error.message : String(error)}`);
        await delay(Math.max(2_000, pollMs));
        continue;
      }
      if (!job) {
        await delay(pollMs);
        continue;
      }
      await processJob(context, job).catch(async (error) => {
        const message = error instanceof Error ? error.stack || error.message : String(error);
        console.error(`[flow-agent] ${job.id}: ${message}`);
        await agentFetch(`/api/ai/content-machine/flow-agent/jobs/${job.id}/fail`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ agentId, error: message }),
        }).catch(() => undefined);
      });
    }
  } finally {
    await context.close();
  }
}

async function claimJob(): Promise<AgentJob | null> {
  const response = await agentFetch("/api/ai/content-machine/flow-agent/jobs/next", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ agentId }),
  });
  const text = await response.text();
  let data: { job: AgentJob | null; error?: string };
  try {
    data = JSON.parse(text) as typeof data;
  } catch {
    throw new Error(`CRM вернула не-JSON ответ, HTTP ${response.status}.`);
  }
  if (!response.ok) throw new Error(data.error || `CRM вернула HTTP ${response.status}.`);
  return data.job;
}

async function processJob(context: Awaited<ReturnType<typeof chromium.launchPersistentContext>>, job: AgentJob) {
  const jobDirectory = path.join(workDirectory, job.id);
  await rm(jobDirectory, { recursive: true, force: true });
  await mkdir(jobDirectory, { recursive: true });
  const products = new Map<number, string>();
  const backgrounds = new Map<BackgroundSlot, string>();
  await Promise.all([
    ...job.products.map(async (product) => {
      const target = path.join(jobDirectory, product.fileName);
      await downloadAsset(job.id, "products", product.fileName, target);
      products.set(product.index, target);
    }),
    ...job.backgrounds.map(async (background) => {
      const target = path.join(jobDirectory, background.fileName);
      await downloadAsset(job.id, "backgrounds", background.fileName, target);
      backgrounds.set(background.slot, target);
    }),
  ]);

  const completed = new Set(job.results.map((result) => `${result.productIndex}:${result.backgroundSlot}`));
  const work = job.products.flatMap((product) => job.backgrounds
    .filter((background) => !completed.has(`${product.index}:${background.slot}`))
    .map((background) => ({ product, background })));
  console.log(`[flow-agent] ${job.id}: ${work.length} фото`);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, work.length) }, async () => {
    while (cursor < work.length) {
      const item = work[cursor++];
      const page = await context.newPage();
      const outputPath = path.join(jobDirectory, `product-${String(item.product.index).padStart(2, "0")}-background-${item.background.slot}.png`);
      try {
        const timing = await generateFlowImage({
          page,
          flowUrl,
          references: [products.get(item.product.index)!, backgrounds.get(item.background.slot)!],
          prompt: job.generationPrompt || defaultPrompt(),
          outputPath,
          timeoutMs: generationTimeoutMs,
        });
        await uploadResult(job.id, item.product.index, item.background.slot, outputPath, timing);
        console.log(`[flow-agent] ${job.id} ${item.product.index}/${item.background.slot}: ${(timing.durationMs / 1000).toFixed(1)} сек`);
      } finally {
        await page.close();
      }
    }
  }));
}

async function downloadAsset(jobId: string, kind: string, fileName: string, target: string) {
  const response = await agentFetch(`/api/ai/content-machine/flow-agent/jobs/${jobId}/asset/${kind}/${encodeURIComponent(fileName)}`);
  if (!response.ok) throw new Error(`Не удалось скачать ${fileName}: HTTP ${response.status}.`);
  await writeFile(target, Buffer.from(await response.arrayBuffer()));
}

async function uploadResult(
  jobId: string,
  productIndex: number,
  backgroundSlot: BackgroundSlot,
  filePath: string,
  timing: Awaited<ReturnType<typeof generateFlowImage>>,
) {
  const form = new FormData();
  form.set("agentId", agentId);
  form.set("productIndex", String(productIndex));
  form.set("backgroundSlot", backgroundSlot);
  for (const [key, value] of Object.entries(timing)) form.set(key, String(value));
  form.set("file", new Blob([await readFile(filePath)], { type: "image/png" }), path.basename(filePath));
  const response = await agentFetch(`/api/ai/content-machine/flow-agent/jobs/${jobId}/result`, { method: "POST", body: form });
  if (!response.ok) throw new Error(`CRM не приняла результат: HTTP ${response.status} ${await response.text()}`);
}

function agentFetch(route: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${token}`);
  return fetch(`${baseUrl}${route}`, { ...init, headers, signal: AbortSignal.timeout(120_000) });
}

function defaultPrompt() {
  return "Create exactly one photorealistic e-commerce product photo. Use the first image as the exact product identity and the second image as the exact background, composition and lighting reference. Preserve print, color, seams, text, proportions and visible side. Return only the final image.";
}

function clamp(value: number, min: number, max: number) {
  return Number.isFinite(value) ? Math.min(max, Math.max(min, Math.round(value))) : min;
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 1;
});
