import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("orders summary widgets", () => {
  it("uses the server summary for the full filtered order set", () => {
    const source = readFileSync(
      path.resolve(__dirname, "../components/orders/orders-client.tsx"),
      "utf8",
    );

    expect(source).toContain("const filteredReceivedTotals = summary");
    expect(source).toContain("setSummary(data.summary)");
    expect(source).toContain("formatRub(filteredReceivedTotals.revenue)");
    expect(source).toContain("formatRub(filteredReceivedTotals.profit)");
  });
});
