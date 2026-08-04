import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { createExactFrontPrintDetail, normalizeFlowResult } from "@/lib/flow-agent/image-output";

describe("Flow result output size", () => {
  it("creates a real 4096px 4K output profile", async () => {
    const source = await sharp({
      create: { width: 256, height: 128, channels: 3, background: "#222222" },
    }).png().toBuffer();
    const output = await normalizeFlowResult(source, "4K");
    await expect(sharp(output).metadata()).resolves.toMatchObject({ width: 4096, height: 2048, format: "png" });
  });

  it("does not enlarge a small source in the 2K profile", async () => {
    const source = await sharp({
      create: { width: 256, height: 128, channels: 3, background: "#222222" },
    }).png().toBuffer();
    const output = await normalizeFlowResult(source, "2K");
    await expect(sharp(output).metadata()).resolves.toMatchObject({ width: 256, height: 128, format: "png" });
  });

  it("preserves Flow's full portrait 2K dimensions", async () => {
    const source = await sharp({
      create: { width: 1536, height: 2752, channels: 3, background: "#222222" },
    }).jpeg().toBuffer();
    const output = await normalizeFlowResult(source, "2K");
    await expect(sharp(output).metadata()).resolves.toMatchObject({ width: 1536, height: 2752, format: "png" });
  });
});

describe("createExactFrontPrintDetail", () => {
  it("keeps the canvas geometry and crops the immutable centre print region", async () => {
    const source = await sharp({
      create: { width: 600, height: 900, channels: 3, background: "black" },
    })
      .composite([
        { input: { create: { width: 70, height: 20, channels: 3, background: "white" } }, left: 265, top: 220 },
        { input: { create: { width: 300, height: 120, channels: 3, background: "#f5f0dc" } }, left: 150, top: 390 },
      ])
      .png()
      .toBuffer();

    const output = await createExactFrontPrintDetail(source);
    const metadata = await sharp(output).metadata();
    const centre = await sharp(output).extract({ left: 450, top: 300, width: 1_150, height: 850 }).stats();

    expect(metadata).toMatchObject({ width: 2_048, height: 1_152 });
    expect(centre.channels[0].mean).toBeGreaterThan(70);
  });
});
