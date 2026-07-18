import { describe, expect, it } from "vitest";
import { mergeAvitoXml, xmlIdScopeFromProfile } from "@/lib/botv/session";

describe("BotV publication XML", () => {
  it("uses a drop-specific id scope for the same profile", () => {
    expect(xmlIdScopeFromProfile("profile-1", "drop-1")).not.toBe(xmlIdScopeFromProfile("profile-1", "drop-2"));
    expect(xmlIdScopeFromProfile("profile-1", "drop-1")).toBe(xmlIdScopeFromProfile("profile-1", "drop-1"));
  });

  it("carries previous ads without duplicating current ids", () => {
    const current = `<Ads><Ad><Id>SKU-new-1</Id><Title>New</Title></Ad><Ad><Id>SKU-old-2</Id><Title>Updated</Title></Ad></Ads>`;
    const previous = `<Ads><Ad><Id>SKU-old-1</Id><Title>Old</Title></Ad><Ad><Id>SKU-old-2</Id><Title>Old duplicate</Title></Ad></Ads>`;

    const result = mergeAvitoXml(current, previous);

    expect(result.ads).toBe(3);
    expect(result.previousAds).toBe(1);
    expect(result.adIds).toEqual(["SKU-new-1", "SKU-old-2", "SKU-old-1"]);
    expect(result.xml).toContain("<Title>New</Title>");
    expect(result.xml).toContain("<Title>Updated</Title>");
    expect(result.xml).toContain("<Title>Old</Title>");
    expect(result.xml).not.toContain("Old duplicate");
  });
});
