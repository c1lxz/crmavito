import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { compactFlowPrompt, FLOW_IMAGE_MODELS, inferFlowImageAspectRatio, isFlowAccessGateUrl, isFlowModelLimitText } from "@/lib/flow-agent/browser";
import { compareFlowImageGeometry } from "@/lib/flow-agent/image-output";
import { buildOriginalStagePrompt } from "@/lib/flow-agent/original-design";

const agentSource = fs.readFileSync(path.join(process.cwd(), "scripts/flow-local-agent.ts"), "utf8");

describe("Flow model fallback", () => {
  it("releases region/marketing-page failures so another configured agent can retry", () => {
    expect(agentSource).toContain("marketing page|redirected Flow|Flow access");
  });

  it("uses the requested Pro to standard to Lite order", () => {
    expect(FLOW_IMAGE_MODELS).toEqual([
      "Nano Banana Pro",
      "Nano Banana 2",
      "Nano Banana 2 Lite",
    ]);
  });

  it("recognizes the silent redirect from Flow to the Labs home page", () => {
    expect(isFlowAccessGateUrl("https://labs.google/")).toBe(true);
    expect(isFlowAccessGateUrl("https://labs.google/fx/tools/flow")).toBe(false);
    expect(isFlowAccessGateUrl("https://labs.google/fx/tools/flow/project/123/edit/456")).toBe(false);
  });

  it("recognizes daily model-limit messages in English and Russian", () => {
    expect(isFlowModelLimitText("You've reached your daily limit. Try a different model.")).toBe(true);
    expect(isFlowModelLimitText("Вы достигли дневного лимита на генерацию. Попробуйте использовать другую модель.")).toBe(true);
    expect(isFlowModelLimitText("Дневной лимит исчерпан. Выберите другую модель.")).toBe(true);
    expect(isFlowModelLimitText("Something went wrong. Try again.")).toBe(false);
  });
});

describe("Flow canvas lock", () => {
  it("selects the closest Flow ratio from the uploaded background", () => {
    expect(inferFlowImageAspectRatio(1152, 2048)).toBe("9:16");
    expect(inferFlowImageAspectRatio(2048, 1152)).toBe("16:9");
    expect(inferFlowImageAspectRatio(1200, 1600)).toBe("3:4");
  });

  it("rejects a landscape result for a portrait background before upload", () => {
    expect(compareFlowImageGeometry(
      { width: 1152, height: 2048 },
      { width: 2048, height: 1152 },
    )).toMatchObject({ pass: false });
    expect(compareFlowImageGeometry(
      { width: 1152, height: 2048 },
      { width: 1152, height: 2048 },
    )).toEqual({ pass: true, issue: "" });
  });
});

describe("original design stages", () => {
  const base = "Create a premium original archive-fashion garment.";

  it("creates a front anchor without generic mascot art or any exterior tag", () => {
    const prompt = buildOriginalStagePrompt("front-anchor", base, 4);
    expect(prompt).toContain("FRONT DESIGN ANCHOR");
    expect(prompt).toContain("IMAGES 1-4");
    expect(prompt).toContain("show the proven source garment");
    expect(prompt).toContain("IMAGE 5 is the ONLY SCENE REFERENCE");
    expect(prompt).toContain("No generic animals, winner stars, horse/equine figure");
    expect(prompt).toContain("24 x 32 cm");
    expect(prompt).toContain("not abstract squares, rectangles, grids");
    expect(prompt).toContain("NO hang tag, paper tag, sewn label, woven tab");
    expect(prompt).toContain("Do not generate L.G.B.");
  });

  it("generates the first anchor from the approved scene only, without marketplace leakage", () => {
    const prompt = buildOriginalStagePrompt("front-anchor", base, 0, { preserveWinnerLabel: true });
    expect(prompt).toContain("marketplace photos were analyzed before this generation and are NOT attached");
    expect(prompt).toContain("IMAGE 1 is the ONLY SCENE REFERENCE");
    expect(prompt).toContain("ZERO WATERMARKS");
    expect(prompt).not.toContain("IMAGES 1-0");
  });

  it("preserves the winner's exact internal neck mark in automatic front views", () => {
    const prompt = buildOriginalStagePrompt("front-anchor", base, 1, { preserveWinnerLabel: true });
    expect(prompt).toContain("WINNER LABEL LOCK");
    expect(prompt).toContain("exact visible internal neck label or heat-transfer marking");
    expect(prompt).toContain("Never place it on the outer chest");
    expect(prompt).toContain("Never invent a substitute, hang tag, fastener or exterior label");
    expect(prompt).not.toContain("collar completely clean");

    const compacted = compactFlowPrompt(prompt);
    expect(compacted).toContain("WINNER LABEL LOCK");
    expect(compacted).toContain("preserve the exact visible internal neck label");
    expect(compacted).not.toContain("internal heat-transfer marking stays hidden");

    const back = buildOriginalStagePrompt("back-anchor", base, 1, { preserveWinnerLabel: true });
    expect(back).toContain("NO VISIBLE LABEL OR LABEL TEXT");
  });

  it("keeps the approved brief and rejects generic AI logo fallbacks", () => {
    const brief = "APPROVED FRONT: an editorial botanical illustration with exact text. APPROVED BACK: a distinct typographic composition.";
    const front = buildOriginalStagePrompt("front-anchor", brief, 4);
    const back = buildOriginalStagePrompt("back-anchor", brief, 4);
    expect(front).toContain("editorial botanical illustration");
    expect(front).toContain("no radial ring of repeated objects");
    expect(front).toContain("Any required words must match the brief exactly");
    expect(back).toContain("distinct typographic composition");
    expect(back).toContain("never one tiny token below the collar");
    expect(back).not.toContain("NIGHT VEIL");
  });

  it("turns the generated front anchor over to create a distinct coordinated back", () => {
    const prompt = buildOriginalStagePrompt("back-anchor", base, 4);
    expect(prompt).toContain("BACK DESIGN ANCHOR");
    expect(prompt).toContain("IMAGE 1 is the new FRONT ANCHOR");
    expect(prompt).toContain("IMAGE 2 is SCENE ONLY");
    expect(prompt).toContain("higher closed back neckline");
    expect(prompt).toContain("NO VISIBLE LABEL OR LABEL TEXT");
    expect(prompt).toContain("different primary subject and silhouette");
    expect(prompt).toContain("No all-over, tiled, wraparound, sleeve, seam-crossing or edge-to-edge print");
  });

  it("locks later photos to the generated product anchor", () => {
    const prompt = buildOriginalStagePrompt("front-photo", base, 4);
    expect(prompt).toContain("IMAGE 1 is the immutable front anchor");
    expect(prompt).toContain("IMAGE 2 is SCENE ONLY");
    expect(prompt).toContain("Never redesign");
    expect(buildOriginalStagePrompt("back-photo", base, 4)).toContain("NO hang tag, paper tag, sewn label");
  });

  it("makes slot three a real close product photograph instead of a crop", () => {
    const prompt = buildOriginalStagePrompt("front-detail", base, 4);
    expect(prompt).toContain("FINAL FRONT PRINT DETAIL");
    expect(prompt).toContain("never a digital crop");
    expect(prompt).toContain("35-50% of the frame");
    expect(prompt).toContain("show the collar, at least one complete sleeve");
    expect(prompt).toContain("patch, cleanup smear");
  });

  it("keeps a custom market concept ahead of generic stage rules after Flow compaction", () => {
    const custom = [
      "MARKET-GROUNDED ORIGINAL DESIGN — RED THREAD CONTACT.",
      "FRONT: one elegant human hand pinching a wine-red thread.",
      "BACK: two reaching hands connected by the same thread.",
      "PRODUCTION LOCK: maximum 24 x 32 cm.",
      "NO skulls, bones, crosses, spiders, animals, stars or text.",
    ].join(" ");
    const compacted = compactFlowPrompt(buildOriginalStagePrompt("front-anchor", custom, 4));
    expect(compacted).toContain("RED THREAD CONTACT");
    expect(compacted).toContain("one elegant human hand");
    expect(compacted).toContain("NO skulls, bones, crosses");
    expect(compacted).toContain("not generic gothic art");
    expect(compacted).not.toContain("Never suppress an approved bone");
  });

  it("does not append the legacy skull-and-bone ban to NIGHT VEIL stage prompts", () => {
    const fallback = `DEMAND-GROUNDED FALLBACK CONCEPT вЂ” NIGHT VEIL. ${"Preserve the approved visual language. ".repeat(80)}`;
    const canvasLock = `${"OUTPUT CANVAS LOCK and production constraint. ".repeat(18)}`;
    const anchor = compactFlowPrompt(`${canvasLock} ${buildOriginalStagePrompt("back-anchor", fallback, 4)}`);
    const finalFront = compactFlowPrompt(`${canvasLock} ${buildOriginalStagePrompt("front-photo", fallback, 4)}`);
    expect(anchor.length).toBeLessThanOrEqual(1_400);
    expect(anchor).toContain("Never suppress an approved bone, skull, web or cross");
    expect(anchor).not.toContain("ABSOLUTELY NO animal, animal fragment, skull");
    expect(finalFront).toContain("upper external chest and collar free of label text");
    expect(finalFront).toContain("internal heat-transfer marking stays hidden");
    expect(finalFront).not.toContain("ABSOLUTELY NO animal, animal fragment, skull");
  });
});
