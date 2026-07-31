import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { generateFlowImage } from "@/lib/flow-agent/browser";

let browser: Awaited<ReturnType<typeof chromium.launch>>;

beforeAll(async () => {
  browser = await chromium.launch({ channel: "chrome", headless: true });
});

afterAll(async () => {
  await browser?.close();
});

describe("Flow local browser agent", () => {
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
      const timings = await Promise.all([1, 2, 3].map(async (index) => {
        const page = await context.newPage();
        try {
          return await generateFlowImage({
            page,
            flowUrl: fixtureUrl,
            references: [referenceA, referenceB],
            prompt: `Photo ${index}`,
            outputPath: path.join(directory, `result-${index}.png`),
            timeoutMs: 5_000,
          });
        } finally {
          await page.close();
        }
      }));
      const elapsed = Date.now() - started;
      expect(await Promise.all([1, 2, 3].map((index) => readFile(path.join(directory, `result-${index}.png`))))).toSatisfy(
        (files: Buffer[]) => files.every((file) => file.length > 50),
      );
      expect(timings.every((timing) => timing.generationMs >= 100 && timing.durationMs < 3_000)).toBe(true);
      expect(elapsed).toBeLessThan(5_000);
      expect(context.pages()).toHaveLength(0);
    } finally {
      await context.close();
      await rm(directory, { recursive: true, force: true });
    }
  }, 15_000);
});
