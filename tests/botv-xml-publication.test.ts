import { describe, expect, it } from "vitest";
import { xmlIdScopeFromProfile } from "@/lib/botv/session";

describe("BotV publication XML", () => {
  it("uses a drop-specific id scope for the same profile", () => {
    expect(xmlIdScopeFromProfile("profile-1", "drop-1")).not.toBe(xmlIdScopeFromProfile("profile-1", "drop-2"));
    expect(xmlIdScopeFromProfile("profile-1", "drop-1")).toBe(xmlIdScopeFromProfile("profile-1", "drop-1"));
  });
});
