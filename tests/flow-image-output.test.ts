import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { normalizeFlowResult } from "@/lib/flow-agent/image-output";

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
});
