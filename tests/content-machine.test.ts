import fs from "node:fs";
import { File } from "node:buffer";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { claimNextFlowJob, createCodexJob, getCodexJob, saveFlowJobResult } from "@/lib/ai/content-machine-jobs";
import { saveBackground } from "@/lib/ai/content-machine";

const root = path.resolve(__dirname, "..");
const clientSource = fs.readFileSync(path.join(root, "components/content-machine/content-machine-client.tsx"), "utf8");
const generateRouteSource = fs.readFileSync(path.join(root, "app/api/ai/content-machine/generate-image/route.ts"), "utf8");
const backgroundsRouteSource = fs.readFileSync(path.join(root, "app/api/ai/content-machine/backgrounds/route.ts"), "utf8");
const storageSource = fs.readFileSync(path.join(root, "lib/ai/content-machine.ts"), "utf8");
const jobsSource = fs.readFileSync(path.join(root, "lib/ai/content-machine-jobs.ts"), "utf8");
const klingSource = fs.readFileSync(path.join(root, "lib/ai/kling-images.ts"), "utf8");
const klingJobsSource = fs.readFileSync(path.join(root, "lib/ai/kling-content-machine-jobs.ts"), "utf8");

const originalDataDirectory = process.env.CONTENT_MACHINE_DATA_DIR;
afterEach(() => {
  if (originalDataDirectory === undefined) delete process.env.CONTENT_MACHINE_DATA_DIR;
  else process.env.CONTENT_MACHINE_DATA_DIR = originalDataDirectory;
});

describe("content machine", () => {
  it("starts local Google Flow jobs from the content machine", () => {
    expect(clientSource).toContain('fetch("/api/ai/content-machine/codex-jobs"');
    expect(clientSource).toContain("content-machine-flow-job");
    expect(clientSource).toContain("Flow онлайн");
    expect(clientSource).toContain("/api/ai/content-machine/flow-agent/status");
    expect(clientSource).toContain("Скачать выбранные");
    expect(clientSource).not.toContain("generateGeminiImage");
    expect(jobsSource).toContain('provider: "google-flow"');
    expect(jobsSource).toContain("claimNextFlowJob");
    expect(jobsSource).toContain("averageGenerationMs");
    expect(klingSource).toContain("https://api-singapore.klingai.com");
    expect(klingSource).toContain("/v1/images/omni-image");
    expect(klingSource).toContain("kling-v3-omni");
    expect(klingJobsSource).toContain("createKlingImageTask");
    expect(klingJobsSource).toContain('path.resolve(process.env.CONTENT_MACHINE_DATA_DIR, "kling-jobs")');
  });

  it("keeps exactly three persistent reference background slots", () => {
    expect(storageSource).toContain('BACKGROUND_SLOTS = ["1", "2", "3"]');
    expect(storageSource).toContain("CONTENT_MACHINE_DATA_DIR");
    expect(backgroundsRouteSource).toContain("saveBackground(slot, file)");
  });

  it("keeps the old Gemini and Kling integrations isolated while the UI uses Flow jobs", () => {
    expect(generateRouteSource).toContain("generateGeminiImage");
    expect(jobsSource).toContain('path.join(directory, "results")');
    expect(jobsSource).toContain("Обработай задание");
  });

  it("claims a Flow job, accepts timed results, and exposes aggregate performance", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "crmavito-flow-job-"));
    process.env.CONTENT_MACHINE_DATA_DIR = directory;
    try {
      for (const slot of ["1", "2", "3"] as const) {
        await saveBackground(slot, new File([`background-${slot}`], `background-${slot}.jpg`, { type: "image/jpeg" }) as unknown as globalThis.File);
      }
      const created = await createCodexJob(
        [new File(["product"], "shirt.jpg", { type: "image/jpeg" }) as unknown as globalThis.File],
        "2K",
      );
      const claimed = await claimNextFlowJob("test-agent");
      expect(claimed?.id).toBe(created.id);
      expect(claimed?.agentStatus).toBe("processing");
      expect(await claimNextFlowJob("other-agent")).toBeNull();

      await Promise.all((["1", "2", "3"] as const).map((slot) =>
        saveFlowJobResult(created.id, {
          agentId: "test-agent",
          productIndex: 1,
          backgroundSlot: slot,
          file: new File([`result-${slot}`], `result-${slot}.png`, { type: "image/png" }) as unknown as globalThis.File,
          metric: { startedAt: new Date().toISOString(), durationMs: 1200, uploadMs: 100, generationMs: 1000 },
        }),
      ));
      const ready = await getCodexJob(created.id);
      expect(ready.status).toBe("ready");
      expect(ready.results).toHaveLength(3);
      expect(ready.metrics?.averageGenerationMs).toBe(1200);
      expect(ready.agentStatus).toBe("complete");
      expect(ready.metrics?.totalDurationMs).toBeGreaterThanOrEqual(0);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("moves a job from waiting to ready when Codex result files appear", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "crmavito-codex-job-"));
    process.env.CONTENT_MACHINE_DATA_DIR = directory;
    try {
      for (const slot of ["1", "2", "3"] as const) {
        await saveBackground(slot, new File([`background-${slot}`], `background-${slot}.jpg`, { type: "image/jpeg" }) as unknown as globalThis.File);
      }
      const product = new File(["product"], "shirt.jpg", { type: "image/jpeg" }) as unknown as globalThis.File;
      const created = await createCodexJob([product], "2K");
      expect(created.status).toBe("waiting");
      expect(created.expectedResults).toBe(3);
      expect(created.qualityProfile).toBe("photorealistic-v2");
      expect(created.generationPrompt).toContain("tight contact shadow");

      const resultDirectory = path.join(directory, "codex-jobs", created.id, "results");
      await mkdir(resultDirectory, { recursive: true });
      for (const slot of ["1", "2", "3"]) {
        await writeFile(path.join(resultDirectory, `product-01-background-${slot}.png`), `result-${slot}`);
      }
      const ready = await getCodexJob(created.id);
      expect(ready.status).toBe("ready");
      expect(ready.results).toHaveLength(3);
      expect(ready.results[0].url).toContain(`/codex-jobs/${created.id}/files/results/`);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
