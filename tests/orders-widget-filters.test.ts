import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("orders summary widgets", () => {
  it("recalculates revenue and profit from the currently filtered received orders", () => {
    const source = readFileSync(
      path.resolve(__dirname, "../components/orders/orders-client.tsx"),
      "utf8",
    );

    expect(source).toContain("const filteredReceivedTotals = useMemo");
    expect(source).toContain('if (order.status === "RECEIVED")');
    expect(source).toContain("totals.revenue += order.revenue");
    expect(source).toContain("totals.profit += order.netProfit");
    expect(source).toContain("formatRub(filteredReceivedTotals.revenue)");
    expect(source).toContain("formatRub(filteredReceivedTotals.profit)");
  });
});
