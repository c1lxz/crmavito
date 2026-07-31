import fs from "node:fs";
import { File } from "node:buffer";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  claimNextFlowJob,
  createCodexJob,
  failFlowJob,
  getCodexJob,
  releaseFlowJob,
  retryFlowJob,
  saveFlowJobResult,
} from "@/lib/ai/content-machine-jobs";
import { saveBackground } from "@/lib/ai/content-machine";
import { buildOriginalDesignPrompt } from "@/lib/flow-agent/market-research";
import { createClaudeDesignMetaPrompt } from "@/lib/ai/claude-content-design";

const root = path.resolve(__dirname, "..");
const clientSource = fs.readFileSync(path.join(root, "components/content-machine/content-machine-client.tsx"), "utf8");
const diagnosticsSource = fs.readFileSync(path.join(root, "components/content-machine/content-machine-diagnostics.tsx"), "utf8");
const draftSource = fs.readFileSync(path.join(root, "lib/client/content-machine-draft.ts"), "utf8");
const flowBrowserSource = fs.readFileSync(path.join(root, "lib/flow-agent/browser.ts"), "utf8");
const flowAgentSource = fs.readFileSync(path.join(root, "scripts/flow-local-agent.ts"), "utf8");
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
      expect(created.qualityProfile).toBe("photorealistic-v3");
      expect(created.generationPrompt).toContain("tight contact shadows");
      expect(created.generationPrompt?.length).toBeLessThanOrEqual(900);

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

  it("provides screenshot-friendly diagnostics for the system and every image", () => {
    expect(clientSource).toContain("<ContentMachineDiagnostics");
    expect(clientSource).toContain("Диагностика");
    expect(diagnosticsSource).toContain("Полная диагностика");
    expect(diagnosticsSource).toContain("Журнал ошибок при работе");
    expect(diagnosticsSource).toContain("Почему");
    expect(diagnosticsSource).toContain("Что делать");
    expect(clientSource).toContain("reportIncident");
    expect(clientSource).toContain("diagnoseIncident");
    expect(clientSource).toContain("content-machine-diagnostic-incidents");
    expect(clientSource).toContain("loadContentMachineDraft");
    expect(clientSource).toContain("Повторить недостающие");
    expect(clientSource).toContain("disabled={creatingJob || products.length === 0 || !allBackgroundsReady || !designReady}");
    expect(clientSource).not.toContain("agentStatus !== null && !agentReady");
    expect(draftSource).toContain("indexedDB.open");
    expect(draftSource).toContain("products: Array<{ id: string; file: File }>");
    expect(flowBrowserSource).toContain("downloadResultInsideBrowser");
    expect(flowBrowserSource).toContain("водяного знака");
    expect(flowBrowserSource).not.toContain("Google перенаправил агента на общую страницу Labs");
    expect(flowAgentSource).toContain("normalizeFlowResult(source, imageSize)");
    expect(flowAgentSource).toContain('imageSize === "4K" ? 4096 : 2048');
    expect(flowAgentSource).not.toContain(".sharpen({");
    expect(flowAgentSource).toContain("unsupportedVisible");
    expect(flowAgentSource).toContain('child.once("exit"');
    expect(flowAgentSource).not.toContain("child.unref()");
    expect(flowAgentSource).toContain("ERR_TUNNEL_CONNECTION_FAILED");
    expect(jobsSource).toContain("ERR_TUNNEL_CONNECTION_FAILED");
    expect(flowAgentSource).not.toContain('!url.includes("/fx/tools/flow")');
    expect(flowAgentSource).toContain('"release" : "fail"');
    expect(diagnosticsSource).toContain("/api/ai/content-machine/backgrounds");
    expect(diagnosticsSource).toContain("/api/ai/content-machine/flow-agent/status");
    expect(diagnosticsSource).toContain("samplePixels");
    expect(diagnosticsSource).toContain("Скачать JSON");
    expect(diagnosticsSource).toContain("Изображение не открылось");
    expect(diagnosticsSource).toContain('url.startsWith("blob:")');
    expect(diagnosticsSource).toContain('document.execCommand("copy")');
  });

  it("releases an unavailable agent and lets another agent resume the same job", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "crmavito-flow-release-"));
    process.env.CONTENT_MACHINE_DATA_DIR = directory;
    try {
      for (const slot of ["1", "2", "3"] as const) {
        await saveBackground(slot, new File([`background-${slot}`], `background-${slot}.jpg`, { type: "image/jpeg" }) as unknown as globalThis.File);
      }
      const product = new File(["product"], "shirt.jpg", { type: "image/jpeg" }) as unknown as globalThis.File;
      const created = await createCodexJob([product], "2K");
      expect((await claimNextFlowJob("blocked-agent"))?.id).toBe(created.id);
      await failFlowJob(created.id, "blocked-agent", "Google Flow отклоняет регион или профиль аккаунта.");
      expect(await claimNextFlowJob("blocked-agent")).toBeNull();
      expect((await claimNextFlowJob("working-agent"))?.id).toBe(created.id);
      await releaseFlowJob(created.id, "working-agent", "auth_required");
      await expect(retryFlowJob(created.id)).resolves.toMatchObject({ id: created.id, status: "waiting" });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("creates three original-design variants from multiple views of one proven product", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "crmavito-design-job-"));
    process.env.CONTENT_MACHINE_DATA_DIR = directory;
    try {
      for (const slot of ["1", "2", "3"] as const) {
        await saveBackground(slot, new File([`background-${slot}`], `background-${slot}.jpg`, { type: "image/jpeg" }) as unknown as globalThis.File);
      }
      const winner = new File(["winner"], "winner-long-sleeve.jpg", { type: "image/jpeg" }) as unknown as globalThis.File;
      const created = await createCodexJob([winner, winner], "2K", {
        mode: "original-design",
        inspirationQuery: "vintage gothic long sleeve",
        designNote: "Make the graphic smaller and vary the camera angle.",
        labelStyleReference: "minimal archival luxury",
      });
      expect(created.mode).toBe("original-design");
      expect(created.products).toHaveLength(2);
      expect(created.expectedResults).toBe(3);
      expect(created.inspirationQuery).toBe("vintage gothic long sleeve");
      expect(created.designNote).toBe("Make the graphic smaller and vary the camera angle.");
      expect(created.labelStyleReference).toBe("minimal archival luxury");
      await expect(createCodexJob(Array.from({ length: 7 }, () => winner), "2K", {
        mode: "original-design",
        inspirationQuery: "vintage gothic long sleeve",
      })).rejects.toThrow("6");

      const prompt = buildOriginalDesignPrompt({
        query: "vintage gothic long sleeve",
        checkedAt: new Date().toISOString(),
        listings: [],
        topSignals: ["gothic", "distressed", "oversized"],
        sourceCounts: { grailed: 0, mercari: 0, rakuma: 0 },
      }, undefined, "minimal archival luxury", 2);
      expect(prompt).toContain("Grailed, Mercari and Rakuma");
      expect(prompt).toContain("gothic, distressed, oversized");
      expect(prompt).toContain("Do not reproduce");
      expect(prompt).toContain("CUSTOM MADE");
      expect(prompt).toContain("HARD TEXT CONSTRAINT");
      expect(prompt).toContain("No microtext");
      expect(prompt).toContain("minimal archival luxury");
      expect(prompt).toContain("Never show the reference name");
      expect(prompt).toContain("REFERENCE IMAGES 1-2");
      expect(prompt).toContain("REFERENCE IMAGE 3");
      expect(prompt).toContain(
        "Preserve the background identity, perspective and light from REFERENCE IMAGE 3",
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("asks Claude vision for a production-ready Flow meta-prompt", async () => {
    let requestBody = "";
    const expectedPrompt = [
      "Create one original black long-sleeve garment with a newly composed high-contrast screen print.",
      "Use reference image 1 only for broad commercial hierarchy and reference image 2 for the exact background and lighting.",
      "Preserve realistic cotton weave, seams, folds, print absorption, contact shadows, lens perspective and marketplace-camera imperfections.",
      "Do not copy any logo, mascot, character, wording, monogram, artist style or distinctive composition.",
      "Return only one photorealistic final image without watermarks, props, halos, pasted graphics or CGI fabric.",
    ].join(" ");
    const tinyPng = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
    const result = await createClaudeDesignMetaPrompt({
      images: [
        { image: tinyPng, mimeType: "image/png" },
        { image: tinyPng, mimeType: "image/png" },
      ],
      query: "gothic long sleeve",
      designNote: "Make the graphic smaller and provide varied camera angles.",
      labelStyleReference: "minimal archival luxury",
      research: {
        query: "gothic long sleeve",
        checkedAt: new Date().toISOString(),
        listings: [],
        topSignals: ["gothic mood", "large central graphic"],
        sourceCounts: { grailed: 3, mercari: 3, rakuma: 3 },
      },
    }, {
      apiKey: "test-key",
      baseUrl: "https://claude.test",
      model: "test-claude",
      fetchFn: async (_url, init) => {
        requestBody = String(init?.body);
        return new Response(JSON.stringify({ content: [{ type: "text", text: expectedPrompt }] }), { status: 200 });
      },
    });
    expect(result.prompt).toBe(expectedPrompt);
    expect(result.model).toBe("test-claude");
    expect(requestBody).toContain('"type":"image"');
    expect(requestBody.match(/"type":"image"/g)).toHaveLength(2);
    expect(requestBody).toContain("Grailed 3, Mercari 3, Rakuma 3");
    expect(requestBody).toContain("Mandatory user note");
    expect(requestBody).toContain("Make the graphic smaller and provide varied camera angles.");
    expect(requestBody).toContain("Neck-label aesthetic reference: minimal archival luxury");
    expect(requestBody).toContain("CUSTOM MADE");
    expect(requestBody).toContain("hard text constraint");
    expect(requestBody).toContain("pseudo-words");
    expect(requestBody).toContain("never render the reference name");
    expect(requestBody).toContain("REFERENCE IMAGES 1-2");
    expect(requestBody).toContain("REFERENCE IMAGE 3");
    expect(requestBody).toContain("exactly one image per run");
    expect(requestBody).toContain("Do not explain your analysis");
  });
});
