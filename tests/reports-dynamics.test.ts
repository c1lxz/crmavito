import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("reports dynamics chart", () => {
  it("keeps only the orders dynamics chart in reports", () => {
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
    expect(chartSource).toContain("getAverageOrders");
    expect(chartSource).toContain("Сред. в день");
    expect(chartSource).toContain("Сред. в неделю");
    expect(chartSource).toContain("Сред. в месяц");
    expect(chartSource).toContain("TOOLTIP_CONTENT_STYLE");
    expect(chartSource).toContain('color: "#111827"');
    expect(chartSource).toContain("labelStyle={TOOLTIP_LABEL_STYLE}");
    expect(clientSource).toContain("OrdersDynamicsChart");
    expect(clientSource).not.toContain("<DynamicsChart");
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
