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
    expect(chartSource).toContain("export function OrdersDynamicsChart");
    expect(chartSource).toContain("Динамика заказов");
    expect(chartSource).toContain('dataKey="orders"');
    expect(chartSource).toContain("aggregateByPeriod");
    expect(clientSource).toContain("OrdersDynamicsChart");
  });

  it("includes an Avito profiles chart fed by reports API", () => {
    const reportsSource = readFileSync(path.resolve(__dirname, "../lib/db/reports.ts"), "utf8");
    const routeSource = readFileSync(path.resolve(__dirname, "../app/api/reports/route.ts"), "utf8");
    const clientSource = readFileSync(path.resolve(__dirname, "../components/reports/reports-client.tsx"), "utf8");

    expect(reportsSource).toContain("getAvitoProfileCounts");
    expect(reportsSource).toContain("avitoProfileId");
    expect(routeSource).toContain('"avito-profiles"');
    expect(clientSource).toContain("Заказы по профилям Avito");
  });
});
