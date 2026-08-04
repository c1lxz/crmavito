import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FlowModelLimitError, generateFlowImage } from "@/lib/flow-agent/browser";

let browser: Awaited<ReturnType<typeof chromium.launch>>;

beforeAll(async () => {
  browser = await chromium.launch({ channel: "chrome", headless: true });
});

afterAll(async () => {
  await browser?.close();
});

describe("Flow local browser agent", () => {
  it("rejects a project URL that Google silently replaces with the marketing page", async () => {
    const context = await browser.newContext();
    const page = await context.newPage();
    const landing = "data:text/html,<button>Try in Google Flow</button><h1>Unlock your best creative work</h1>";
    try {
      const started = Date.now();
      await expect(generateFlowImage({
        page,
        flowUrl: landing,
        references: [],
        prompt: "This request must never reach the upload stage.",
        outputPath: path.join(os.tmpdir(), "flow-landing-must-not-generate.png"),
        timeoutMs: 8_000,
      })).rejects.toThrow(/marketing landing page/i);
      expect(Date.now() - started).toBeLessThan(2_000);
    } finally {
      await context.close();
    }
  }, 10_000);

  it("detects a model limit rendered as a regular assistant response", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "flow-agent-limit-e2e-"));
    const referenceA = path.join(directory, "product.png");
    const referenceB = path.join(directory, "background.png");
    const tinyPng = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
    await Promise.all([writeFile(referenceA, tinyPng), writeFile(referenceB, tinyPng)]);
    const fixtureUrl = `${pathToFileURL(path.resolve(__dirname, "fixtures/flow-mock.html")).href}?limit=1`;
    const context = await browser.newContext();
    const page = await context.newPage();
    try {
      const started = Date.now();
      await expect(generateFlowImage({
        page,
        flowUrl: fixtureUrl,
        references: [referenceA, referenceB],
        prompt: "Photo with quota fallback",
        outputPath: path.join(directory, "result.png"),
        timeoutMs: 8_000,
      })).rejects.toBeInstanceOf(FlowModelLimitError);
      expect(Date.now() - started).toBeLessThan(4_000);
    } finally {
      await context.close();
      await rm(directory, { recursive: true, force: true });
    }
  }, 10_000);

  it("opens independent projects in parallel, uploads two references, and records timings", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "flow-agent-e2e-"));
    const referenceA = path.join(directory, "product.png");
    const referenceB = path.join(directory, "background.png");
    const tinyPng = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
    await Promise.all([writeFile(referenceA, tinyPng), writeFile(referenceB, tinyPng)]);
    const fixtureUrl = pathToFileURL(path.resolve(__dirname, "fixtures/flow-mock.html")).href;
    const context = await browser.newContext();
    const started = Date.now();
    try {
      const timings = await Promise.all([1, 2, 3, 4].map(async (index) => {
        const page = await context.newPage();
        try {
          return await generateFlowImage({
            page,
            flowUrl: fixtureUrl,
            references: [referenceA, referenceB],
            prompt: `Photo ${index}`,
            outputPath: path.join(directory, `result-${index}.png`),
            timeoutMs: 5_000,
            downloadResolution: "2K",
          });
        } finally {
          await page.close();
        }
      }));
      const elapsed = Date.now() - started;
      expect(await Promise.all([1, 2, 3, 4].map((index) => readFile(path.join(directory, `result-${index}.png`))))).toSatisfy(
        (files: Buffer[]) => files.every((file) => file.length > 50),
      );
      expect(await Promise.all([1, 2, 3, 4].map((index) => sharp(path.join(directory, `result-${index}.png`)).metadata())))
        .toSatisfy((files) => files.every((file) => file.width === 2048 && file.height === 2048));
      expect(timings.every((timing) => timing.generationMs >= 100 && timing.durationMs < 5_000)).toBe(true);
      expect(elapsed).toBeLessThan(7_000);
      expect(context.pages()).toHaveLength(0);
    } finally {
      await context.close();
      await rm(directory, { recursive: true, force: true });
    }
  }, 15_000);
});
