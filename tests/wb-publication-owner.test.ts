import { describe, expect, it } from "vitest";
import { matchesWbPublicationOwner } from "@/lib/auth/wb-publication-owner";

describe("WB publication owner", () => {
  it("allows only the active user with the exact login and Telegram ID", () => {
    expect(matchesWbPublicationOwner({
      login: "crm_5039428987",
      telegramId: "5039428987",
      isActive: true,
    })).toBe(true);

    expect(matchesWbPublicationOwner({
      login: "crm_5039428987",
      telegramId: "1247326625",
      isActive: true,
    })).toBe(false);
    expect(matchesWbPublicationOwner({
      login: "crm_1247326625",
      telegramId: "5039428987",
      isActive: true,
    })).toBe(false);
    expect(matchesWbPublicationOwner({
      login: "crm_5039428987",
      telegramId: "5039428987",
      isActive: false,
    })).toBe(false);
  });
});
