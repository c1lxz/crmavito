import { describe, expect, it } from "vitest";
import {
  buildOrderFilterQuery,
  sanitizeOrderFilterQuery,
} from "@/lib/orders/filters";

describe("order filter navigation", () => {
  it("preserves active order filters for a detail-page round trip", () => {
    const query = buildOrderFilterQuery({
      q: "трек 123",
      status: "RETURNING",
      counterpartyId: "counterparty-1",
      avitoProfileId: "profile-1",
      warehouse: "1",
      dateFrom: "2026-07-01",
      dateTo: "2026-07-05",
    });

    expect(new URLSearchParams(query)).toEqual(
      new URLSearchParams({
        q: "трек 123",
        status: "RETURNING",
        counterpartyId: "counterparty-1",
        avitoProfileId: "profile-1",
        warehouse: "1",
        dateFrom: "2026-07-01",
        dateTo: "2026-07-05",
      }),
    );
  });

  it("does not persist an inactive status or unrelated parameters", () => {
    expect(
      buildOrderFilterQuery({ status: "ALL", counterpartyId: "ALL" }),
    ).toBe("");
    expect(sanitizeOrderFilterQuery("q=test&admin=true&status=SHIPPED")).toBe(
      "q=test&status=SHIPPED",
    );
    expect(sanitizeOrderFilterQuery("warehouse=yes")).toBe("");
  });
});
