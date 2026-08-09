import { describe, expect, it } from "vitest";
import { buildPromptFromBrief, isApprovedContentMachineDesignPrompt, parseBrief } from "@/lib/flow-agent/design-brief";
import { buildOriginalDesignPrompt, marketSearchQuery } from "@/lib/flow-agent/market-research";

describe("Flow apparel production brief", () => {
  it("uses garment-specific L.G.B. searches for every marketplace", () => {
    expect(marketSearchQuery("grailed", "L.G.B")).toBe("L.G.B. graphic t-shirt");
    expect(marketSearchQuery("mercari", "L.G.B")).toBe("LGB Tシャツ");
    expect(marketSearchQuery("rakuma", "L.G.B")).toBe("LGB Tシャツ");
  });

  const brief = {
    brandAnalysis: "Washed black cotton with a restrained front cue and narrative back statement.",
    marketEvidence: [
      "Grailed: distressed alternative-rock portrait graphics with negative space.",
      "Mercari: asymmetric message and wing graphics on washed dark jersey.",
      "Rakuma: large editorial halftone balanced by narrow exact typography.",
    ],
    conceptName: "Fallen Afterimage",
    conceptStory: "A cracked marble seraph image dissolves like a damaged archive photograph.",
    garment: "washed black slim long-sleeve cotton jersey",
    front: {
      artwork: "distressed halftone crop of one cracked marble seraph eye with a wine-red tear",
      placement: "left upper torso",
      sizeCm: "10 x 7 cm",
    },
    back: {
      artwork: "fragmented marble seraph bust with torn wings dissolving into ink dust",
      placement: "centered upper back",
      sizeCm: "22 x 29 cm",
    },
    inkColors: ["bone", "muted rust"],
    printMethod: "two-pass water-based screen print with restrained distress",
    originalityCheck: "Uses a new marble-seraph composition without copying the winner or listings.",
  };

  it("parses a structured visual-analysis response", () => {
    expect(parseBrief(JSON.stringify(brief))).toMatchObject({
      conceptName: "Fallen Afterimage",
      front: { sizeCm: "10 x 7 cm" },
      back: { sizeCm: "22 x 29 cm" },
    });
  });

  it("locks Flow to a compact printable design instead of arbitrary panels", () => {
    const prompt = buildPromptFromBrief(brief, "exact source neck transfer");
    expect(prompt).toContain("24 cm wide by 32 cm high");
    expect(prompt).toContain("No all-over, tiled, wraparound, sleeve or seam-crossing print");
    expect(prompt).toContain("not a logo exercise, stock clipart or motif salad");
    expect(prompt).toContain("eye/oval/swoosh emblems");
    expect(prompt).toContain("marble seraph");
    expect(prompt).toContain("exact source neck transfer");
  });

  it("rejects copied source motifs before Flow spends a generation", () => {
    expect(() => parseBrief(JSON.stringify({
      ...brief,
      conceptName: "Astral Bison",
      back: { ...brief.back, artwork: "distressed bison with three stars" },
    }))).toThrow("banned motif");
  });

  it("rejects childish animal and celestial concepts before Flow spends a generation", () => {
    for (const artwork of [
      "a watchful owl perched on a crescent moon",
      "a cute cartoon raven mascot",
      "a distressed zodiac serpent",
    ]) {
      expect(() => parseBrief(JSON.stringify({
        ...brief,
        conceptName: "Silent Nocturne",
        front: { ...brief.front, artwork },
      }))).toThrow("banned motif");
    }
  });

  it("invalidates an already cached owl brief so the local agent regenerates it", () => {
    const bad = buildPromptFromBrief({
      ...brief,
      conceptName: "Silent Nocturne",
      conceptStory: "A watchful owl guards the twilight.",
      front: { ...brief.front, artwork: "hand-sketched owl perched on a crescent moon" },
    });
    expect(isApprovedContentMachineDesignPrompt(bad)).toBe(false);
    expect(isApprovedContentMachineDesignPrompt(buildPromptFromBrief(brief))).toBe(true);
  });

  it("rejects artwork larger than the production print area", () => {
    expect(() => parseBrief(JSON.stringify({
      ...brief,
      back: { ...brief.back, sizeCm: "38 x 54 cm" },
    }))).toThrow("exceeds 24 x 32 cm");
  });

  it("rejects a brief without concrete evidence from two marketplaces", () => {
    expect(() => parseBrief(JSON.stringify({
      ...brief,
      marketEvidence: ["Grailed: vague archive styling.", "Mercari: vague styling."],
    }))).toThrow("at least two marketplaces");
  });

  it("keeps a thin-evidence fallback grounded in the winner instead of a fixed gothic concept", () => {
    const prompt = buildOriginalDesignPrompt({
      query: "L.G.B. short sleeve archive graphic",
      checkedAt: new Date().toISOString(),
      listings: [
        { source: "mercari", title: "LGB BLACK STAR RICO T-shirt", url: "https://jp.mercari.com/item/example", price: "¥22,000" },
        { source: "rakuma", title: "00s L.G.B. CROSS t-shirt", url: "https://item.fril.jp/example", price: "¥28,000" },
      ],
      topSignals: ["vintage wash and distressing", "front-and-back graphics"],
      sourceCounts: { grailed: 0, mercari: 1, rakuma: 1 },
    });
    expect(prompt).toContain("use the proven winner itself as the primary quality and hierarchy reference");
    expect(prompt).toContain("Never fall back to an arbitrary gothic symbol");
    expect(prompt).toContain("ACTUAL MARKET EVIDENCE");
    expect(prompt).toContain("¥22,000");
    expect(prompt).not.toContain("NIGHT VEIL");
    expect(prompt).not.toContain("shortwave receiver");
    expect(prompt).toContain("FRONT:");
    expect(prompt).toContain("BACK:");
  });

  it("chooses a marketplace-grounded typography direction when message shirts dominate", () => {
    const prompt = buildOriginalDesignPrompt({
      query: "L.G.B. archive t-shirt",
      checkedAt: new Date().toISOString(),
      listings: [
        { source: "grailed", title: "L.G.B. distressed poem quote graphic tee", url: "https://grailed.com/example" },
        { source: "mercari", title: "LGB MESSAGE archive T-shirt", url: "https://jp.mercari.com/item/example" },
        { source: "rakuma", title: "L.G.B. FREEDOM typography shirt", url: "https://item.fril.jp/example" },
      ],
      topSignals: ["distressed message-shirt hierarchy", "vintage wash"],
      sourceCounts: { grailed: 1, mercari: 1, rakuma: 1 },
    });
    expect(prompt).toContain("deliberate exact-text composition");
    expect(prompt).toContain("specify exact short text with real correctly spelled words");
    expect(prompt).toContain("L.G.B. FREEDOM typography shirt");
    expect(prompt).not.toContain("AFTERTONE MANIFESTO");
    expect(prompt).not.toContain("NIGHT VEIL");
  });
});
