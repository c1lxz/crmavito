import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterEach, describe, expect, it } from "vitest";
import { evaluateShotDiversity } from "@/lib/flow-agent/shot-diversity";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("Flow original-design shot diversity", () => {
  it("rejects near-identical shots and accepts a clearly different camera composition", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "flow-shot-diversity-"));
    temporaryDirectories.push(directory);
    const anchor = path.join(directory, "anchor.png");
    const duplicate = path.join(directory, "duplicate.png");
    const angled = path.join(directory, "angled.png");
    await sharp(Buffer.from('<svg width="600" height="900"><rect width="600" height="900" fill="#aaa"/><rect x="130" y="180" width="340" height="560" rx="40" fill="#111"/><circle cx="300" cy="350" r="70" fill="#eee"/></svg>')).png().toFile(anchor);
    await sharp(anchor).modulate({ brightness: 1.002 }).png().toFile(duplicate);
    await sharp(Buffer.from('<svg width="600" height="900"><rect width="600" height="900" fill="#aaa"/><path d="M110 260 L440 140 L520 690 L190 780 Z" fill="#111"/><circle cx="350" cy="390" r="70" fill="#eee"/></svg>')).png().toFile(angled);

    expect((await evaluateShotDiversity(anchor, duplicate)).pass).toBe(false);
    expect((await evaluateShotDiversity(anchor, angled)).pass).toBe(true);
  });
});
