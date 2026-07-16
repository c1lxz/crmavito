import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("orders to returns donut", () => {
  it("uses KPI order and return counts instead of order status buckets", () => {
    const clientSource = readFileSync(path.resolve(__dirname, "../components/reports/reports-client.tsx"), "utf8");
    const donutSource = readFileSync(path.resolve(__dirname, "../components/dashboard/OrdersStatusDonut.tsx"), "utf8");

    expect(clientSource).toContain('title="Заказы / возвраты"');
    expect(clientSource).toContain('label: "Заказы"');
    expect(clientSource).toContain("count: kpi.current.receivedOrdersCount");
    expect(clientSource).toContain('color: "#22c55e"');
    expect(clientSource).toContain('label: "Возвраты"');
    expect(clientSource).toContain("centerValue={formatPercent(returnsRatio)}");
    expect(clientSource).toContain("showSlicePercentLabels");
    expect(clientSource).toContain('centerLabel="Возвраты"');
    expect(clientSource).not.toContain('fetchReport<Record<string, number>>("order-statuses")');
    expect(donutSource).toContain("centerValue");
    expect(donutSource).toContain("centerLabel");
    expect(donutSource).toContain("renderPercentLabel");
    expect(donutSource).toContain("label={showSlicePercentLabels ? renderPercentLabel : false}");
    expect(donutSource).toContain("{!showSlicePercentLabels &&");
  });
});
