import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterEach, describe, expect, it } from "vitest";
import {
  applyExactLabelOverlay,
  createBestLabelAssets,
  findGeneratedLabelBounds,
  findGeneratedLabelBoundsCandidates,
  hasExtractableWinnerLabel,
  laplacianVariance,
  measureLabelBaselineAngle,
  straightenLabelOverlay,
} from "@/lib/flow-agent/label-lock";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("Flow exact neck-label lock", () => {
  it("scores a crisp collar reference above a blurred one", () => {
    const flat = Buffer.alloc(100, 120);
    const edges = Buffer.from(Array.from({ length: 100 }, (_, index) => index % 2 ? 255 : 0));
    expect(laplacianVariance(edges, 10, 10)).toBeGreaterThan(laplacianVariance(flat, 10, 10));
  });

  it("rejects a winner photo whose collar area has no visible label pixels", async () => {
    const unlabeled = await sharp(Buffer.from(
      '<svg width="1000" height="1800"><rect width="1000" height="1800" fill="#ddd"/><path d="M200 100h600v1300H200z" fill="#111"/></svg>',
    )).jpeg().toBuffer();
    expect(await hasExtractableWinnerLabel(unlabeled)).toBe(false);
  });

  it("finds a generated light label inside a dark collar instead of the light background", async () => {
    const image = await sharp(Buffer.from(
      '<svg width="1000" height="1800"><rect width="1000" height="1800" fill="#aaa"/><rect x="250" y="180" width="500" height="500" rx="180" fill="#111"/><g fill="#eee"><rect x="455" y="345" width="9" height="42"/><rect x="476" y="345" width="9" height="42"/><rect x="497" y="345" width="9" height="42"/><rect x="518" y="345" width="9" height="42"/><rect x="539" y="345" width="9" height="42"/></g></svg>',
    )).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const bounds = findGeneratedLabelBounds(image.data, image.info.width, image.info.height, image.info.channels);
    expect(bounds).toBeDefined();
    expect(bounds!.left).toBeGreaterThan(400);
    expect(bounds!.left + bounds!.width).toBeLessThan(650);
    expect(bounds!.top).toBeGreaterThan(320);
    expect(bounds!.top + bounds!.height).toBeLessThan(410);
  });

  it("rejects an accidentally duplicated exterior label row", async () => {
    const image = await sharp(Buffer.from(
      '<svg width="1000" height="1800"><rect width="1000" height="1800" fill="#aaa"/><rect x="250" y="180" width="500" height="750" rx="180" fill="#111"/><g fill="#eee"><rect x="455" y="345" width="9" height="38"/><rect x="476" y="345" width="9" height="38"/><rect x="497" y="345" width="9" height="38"/><rect x="518" y="345" width="9" height="38"/><rect x="539" y="345" width="9" height="38"/><rect x="450" y="660" width="10" height="38"/><rect x="472" y="660" width="10" height="38"/><rect x="494" y="660" width="10" height="38"/><rect x="516" y="660" width="10" height="38"/><rect x="538" y="660" width="10" height="38"/></g></svg>',
    )).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const candidates = findGeneratedLabelBoundsCandidates(image.data, image.info.width, image.info.height, image.info.channels);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].top).toBeGreaterThan(320);
    expect(candidates[0].top + candidates[0].height).toBeLessThan(410);
  });

  it("chooses the sharpest uploaded collar and composites its exact pixels after Flow", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "flow-label-lock-"));
    temporaryDirectories.push(directory);
    const softPath = path.join(directory, "soft.jpg");
    const sharpPath = path.join(directory, "sharp.jpg");
    const referencePath = path.join(directory, "reference.png");
    const overlayPath = path.join(directory, "overlay.png");
    const outputPath = path.join(directory, "output.jpg");
    const labelSvg = Buffer.from('<svg width="1000" height="1800"><rect width="1000" height="1800" fill="#111"/><text x="540" y="310" fill="#eee" font-size="90" font-family="Arial" font-weight="900">L.G.B.</text></svg>');
    await sharp(labelSvg).blur(8).jpeg().toFile(softPath);
    await sharp(labelSvg).jpeg().toFile(sharpPath);
    await sharp({ create: { width: 1000, height: 1800, channels: 3, background: "#111" } }).jpeg().toFile(outputPath);

    const selected = await createBestLabelAssets([softPath, sharpPath], referencePath, overlayPath);
    expect(selected.sourcePath).toBe(sharpPath);
    expect((await sharp(overlayPath).metadata()).width).toBeGreaterThan(0);
    await applyExactLabelOverlay(outputPath, overlayPath);
    expect(await sharp(outputPath).metadata()).toMatchObject({ width: 1000, height: 1800, format: "jpeg" });
  });

  it("straightens an angled exact label before compositing it", async () => {
    const angled = await sharp(Buffer.from(
      '<svg width="260" height="120"><rect width="260" height="120" fill="none"/><g transform="rotate(14 130 60)" fill="#eee"><rect x="45" y="48" width="170" height="18"/><rect x="55" y="30" width="12" height="45"/><rect x="190" y="30" width="12" height="45"/></g></svg>',
    )).png().toBuffer();
    expect(await measureLabelBaselineAngle(angled)).toBeGreaterThan(8);
    const straightened = await straightenLabelOverlay(angled);
    expect(Math.abs(await measureLabelBaselineAngle(straightened))).toBeLessThan(1.5);
  });
});
