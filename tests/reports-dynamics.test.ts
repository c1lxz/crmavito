import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("reports dynamics chart", () => {
  it("includes order counts alongside revenue and profit", () => {
    const reportsSource = readFileSync(path.resolve(__dirname, "../lib/db/reports.ts"), "utf8");
    const chartSource = readFileSync(path.resolve(__dirname, "../components/dashboard/DynamicsChart.tsx"), "utf8");
    const clientSource = readFileSync(path.resolve(__dirname, "../components/reports/reports-client.tsx"), "utf8");

    expect(reportsSource).toContain("orders: number");
    expect(reportsSource).toContain("getActiveOrders(range)");
    expect(reportsSource).toContain("ensureDay(formatDateInput(order.orderDate)).orders += 1");
    expect(clientSource).toContain("orders: number");
    expect(chartSource).toContain("Заказы");
    expect(chartSource).toContain('dataKey="orders"');
    expect(chartSource).toContain("aggregateByPeriod");
  });
});
