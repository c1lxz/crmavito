import { describe, expect, it } from "vitest";
import {
  analyticsWinnerScore,
  isTShirt,
  normalizeDesignCount,
  selectAnalyticsWinners,
  selectStrokProfiles,
  type AnalyticsWinner,
} from "@/lib/ai/content-machine-auto";
import fs from "node:fs";
import path from "node:path";

function winner(overrides: Partial<AnalyticsWinner>): AnalyticsWinner {
  return {
    itemId: "1",
    title: "Archive tee",
    url: null,
    status: "active",
    views: 100,
    contacts: 0,
    favorites: 0,
    price: null,
    description: null,
    imageCount: 1,
    imageUrl: "https://example.test/photo.jpg",
    profileId: "profile-1",
    profileName: "Main",
    score: 100,
    ...overrides,
  };
}

describe("content-machine analytics automation", () => {
  it("falls back to listing and BotV image resolution when analytics has no image", () => {
    const source = fs.readFileSync(path.join(process.cwd(), "lib/ai/content-machine-auto.ts"), "utf8");
    expect(source).toContain("resolveProductImage({");
    expect(source).toContain("avitoListingUrl: winner.url");
    expect(source).toContain("name: winner.title");
  });

  it("clamps requested positions to the supported 1..100 range", () => {
    expect(normalizeDesignCount(0)).toBe(1);
    expect(normalizeDesignCount(17.6)).toBe(18);
    expect(normalizeDesignCount(500)).toBe(100);
  });

  it("weights contacts and favorites above passive views", () => {
    expect(analyticsWinnerScore({ views: 100, favorites: 2, contacts: 1 })).toBe(170);
    expect(analyticsWinnerScore({ views: 140, favorites: 0, contacts: 0 })).toBe(140);
  });

  it("limits a requested apparel batch to t-shirts", () => {
    expect(isTShirt({ title: "Футболка STROK archive", description: null })).toBe(true);
    expect(isTShirt({ title: "Vintage graphic tee", description: null })).toBe(true);
    expect(isTShirt({ title: "Худи STROK", description: "плотный свитшот" })).toBe(false);
  });

  it("enables the exact winner-label lock for analytics jobs", () => {
    const source = fs.readFileSync(path.join(process.cwd(), "lib/ai/content-machine-auto.ts"), "utf8");
    expect(source).toContain("preserveWinnerLabel: true");
    expect(source).toContain("Preserve the winner's actual hero-side hierarchy");
    expect(source).not.toContain("secondary hook on the front");
    expect(source).toContain("Preserve the winner's exact visible internal neck label");
    expect(source).toContain('garmentType?: "t-shirt"');
    expect(source).toContain("selectStrokProfiles");
    expect(source).toContain("usedWinnerKeys");
    expect(source).toContain("selectedWinners.push(winner)");
    expect(source).toContain("winners: selectedWinners.map");
    expect(source).toContain("hasExtractableWinnerLabel(normalized)");
  });

  it("uses only STROK profiles for unattended analytics batches", () => {
    const profiles = [
      { name: "STROK SHOP", hasCredentials: true },
      { name: "strok shop 2", hasCredentials: true },
      { name: "Kids animals", hasCredentials: true },
      { name: "STROK disabled", hasCredentials: false },
    ];
    expect(selectStrokProfiles(profiles).map((profile) => profile.name)).toEqual(["STROK SHOP", "strok shop 2"]);
  });

  it("allows an explicitly selected credentialed profile without widening unattended batches", () => {
    const profiles = [
      { name: "STROK SHOP", hasCredentials: true },
      { name: "Special profile", hasCredentials: true },
    ];
    expect(selectStrokProfiles(profiles, "  Special   profile ")).toEqual([profiles[1]]);
  });

  it("deduplicates the same position across profiles and keeps strongest demand", () => {
    const selected = selectAnalyticsWinners([
      winner({ itemId: "weak", title: "Same LGB tee", score: 120 }),
      winner({ itemId: "strong", profileId: "profile-2", title: "Same LGB tee", score: 700, contacts: 8 }),
      winner({ itemId: "other", title: "Raf archive top", score: 300, favorites: 10 }),
    ]);
    expect(selected.map((item) => item.itemId)).toEqual(["strong", "other"]);
  });
});
