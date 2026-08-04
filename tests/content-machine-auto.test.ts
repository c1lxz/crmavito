import { describe, expect, it } from "vitest";
import {
  analyticsWinnerScore,
  normalizeDesignCount,
  selectAnalyticsWinners,
  type AnalyticsWinner,
} from "@/lib/ai/content-machine-auto";

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
  it("clamps requested positions to the supported 1..100 range", () => {
    expect(normalizeDesignCount(0)).toBe(1);
    expect(normalizeDesignCount(17.6)).toBe(18);
    expect(normalizeDesignCount(500)).toBe(100);
  });

  it("weights contacts and favorites above passive views", () => {
    expect(analyticsWinnerScore({ views: 100, favorites: 2, contacts: 1 })).toBe(170);
    expect(analyticsWinnerScore({ views: 140, favorites: 0, contacts: 0 })).toBe(140);
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
