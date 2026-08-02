import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { evaluateFlowProductPhoto, parseQualityVerdict, qualityRetryDelayMs } from "@/lib/flow-agent/quality";

describe("Flow product photo quality gate", () => {
  it("accepts a high-confidence clean result", () => {
    expect(parseQualityVerdict('{"pass":true,"score":91,"issues":[]}')).toEqual({
      pass: true,
      score: 91,
      issues: [],
    });
  });

  it("rejects a nominal pass below the strict threshold", () => {
    expect(parseQualityVerdict('```json\n{"pass":true,"score":81,"issues":["print uncertain"]}\n```')).toMatchObject({
      pass: false,
      score: 81,
      issues: ["print uncertain"],
    });
  });

  it("honors Gemini's full retry window instead of retrying too early", () => {
    expect(qualityRetryDelayMs(new Response("", { status: 429, headers: { "retry-after": "58.25" } }), "", 1))
      .toBe(59_750);
    expect(qualityRetryDelayMs(new Response("", { status: 429 }), "Please retry in 49.2s.", 1))
      .toBe(50_700);
  });

  it("falls back to Flash Lite immediately when the primary model is rate limited", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "flow-qa-fallback-"));
    const image = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
    const files = ["product.png", "background.png", "candidate.png"].map((name) => path.join(directory, name));
    await Promise.all(files.map((file) => writeFile(file, image)));
    const fetchFn = vi.fn(async (url: URL | RequestInfo) => String(url).includes("gemini-2.5-flash-lite")
      ? new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"pass":true,"score":96,"issues":[]}' }] } }] }), { status: 200 })
      : new Response(JSON.stringify({ error: { message: "quota exhausted" } }), { status: 429 }));
    try {
      await expect(evaluateFlowProductPhoto(
        { productPath: files[0], backgroundPath: files[1], candidatePath: files[2] },
        { apiKey: "test-key", fetchFn: fetchFn as typeof fetch },
      )).resolves.toMatchObject({ pass: true, score: 96 });
      expect(fetchFn).toHaveBeenCalledTimes(3);
      expect(String(fetchFn.mock.calls[1][0])).toContain("gemini-2.5-flash-lite");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("retries a transient QA transport failure without regenerating the photo", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "flow-qa-network-retry-"));
    const image = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
    const files = ["product.png", "background.png", "candidate.png"].map((name) => path.join(directory, name));
    await Promise.all(files.map((file) => writeFile(file, image)));
    const fetchFn = vi.fn()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockImplementation(async () => new Response(JSON.stringify({
        candidates: [{ content: { parts: [{ text: '{"pass":true,"score":97,"issues":[]}' }] } }],
      }), { status: 200 }));
    try {
      await expect(evaluateFlowProductPhoto(
        { productPath: files[0], backgroundPath: files[1], candidatePath: files[2] },
        { apiKey: "test-key", fetchFn: fetchFn as typeof fetch },
      )).resolves.toMatchObject({ pass: true, score: 97 });
      expect(fetchFn).toHaveBeenCalledTimes(3);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("requires the independent print-count audit to pass", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "flow-qa-"));
    const image = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
    const files = ["product.png", "background.png", "candidate.png"].map((name) => path.join(directory, name));
    await Promise.all(files.map((file) => writeFile(file, image)));
    const verdicts = [
      { pass: true, score: 98, issues: [] },
      { pass: false, score: 60, issues: ["A has 4 motifs; C has 5 motifs"] },
    ];
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ text: JSON.stringify(verdicts.shift()) }] } }],
    }), { status: 200 }));
    try {
      await expect(evaluateFlowProductPhoto(
        { productPath: files[0], backgroundPath: files[1], candidatePath: files[2] },
        { apiKey: "test-key", fetchFn: fetchFn as typeof fetch },
      )).resolves.toMatchObject({
        pass: false,
        score: 60,
        issues: ["A has 4 motifs; C has 5 motifs"],
      });
      expect(fetchFn).toHaveBeenCalledTimes(2);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
