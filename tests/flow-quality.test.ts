import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import {
  evaluateCentralPrintPresence,
  evaluateFlowOriginalDesignAnchor,
  evaluateFlowProductPhoto,
  parseQualityVerdict,
  qualityRetryDelayMs,
} from "@/lib/flow-agent/quality";
import { evaluateFlowProductPhotoWithClaude } from "@/lib/flow-agent/claude-quality";

describe("Flow product photo quality gate", () => {
  it("sends the approved design brief to original-design QA", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "flow-approved-brief-"));
    const imagePath = path.join(directory, "candidate.png");
    await sharp({ create: { width: 32, height: 32, channels: 3, background: "#222" } }).png().toFile(imagePath);
    const fetchFn = vi.fn(async (_url: URL | RequestInfo, init?: RequestInit) => {
      expect(String(init?.body)).toContain("AFTERTONE");
      expect(String(init?.body)).toContain("APPROVED PRODUCTION BRIEF");
      expect(String(init?.body)).toContain("never require or penalize absence of the opposite side");
      return new Response(JSON.stringify({
        candidates: [{ content: { parts: [{ text: '{"pass":true,"score":95,"issues":[]}' }] } }],
      }), { status: 200 });
    });
    try {
      await expect(evaluateFlowOriginalDesignAnchor({
        candidatePath: imagePath,
        sourcePaths: [imagePath],
        side: "front",
        designBrief: "FRONT: exact word AFTERTONE in distressed typography.",
      }, { apiKey: "test-key", fetchFn: fetchFn as typeof fetch })).resolves.toMatchObject({ pass: true, score: 95 });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("rejects a blank dark garment anchor before external vision QA can approve it", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "flow-print-presence-"));
    const blankPath = path.join(directory, "blank.png");
    const printedPath = path.join(directory, "printed.png");
    try {
      const blank = await sharp({ create: { width: 600, height: 900, channels: 3, background: "#111217" } }).png().toBuffer();
      await writeFile(blankPath, blank);
      await sharp(blank)
        .composite([{ input: { create: { width: 140, height: 220, channels: 3, background: "#ddd8c8" } }, left: 230, top: 360 }])
        .png()
        .toFile(printedPath);
      await expect(evaluateCentralPrintPresence(blankPath)).resolves.toMatchObject({ pass: false, score: 0 });
      await expect(evaluateCentralPrintPresence(printedPath)).resolves.toMatchObject({ pass: true, score: 100 });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

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

  it("uses Claude vision as a strict server-side QA fallback", async () => {
    const image = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({
      content: [{ type: "text", text: '{"pass":true,"score":95,"issues":[]}' }],
    }), { status: 200 }));
    await expect(evaluateFlowProductPhotoWithClaude(
      { product: image, background: image, candidate: image },
      { apiKey: "claude-key", baseUrl: "https://claude.test", model: "claude-test", fetchFn: fetchFn as typeof fetch },
    )).resolves.toEqual({ pass: true, score: 95, issues: [], provider: "claude" });
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(String(fetchFn.mock.calls[0][0])).toBe("https://claude.test/v1/messages");
  });
});
