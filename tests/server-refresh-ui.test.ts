import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function source(file: string): string {
  return readFileSync(path.resolve(__dirname, "..", file), "utf8");
}

describe("server refresh propagation", () => {
  it("updates the orders list when refreshed server props arrive", () => {
    const contents = source("components/orders/orders-client.tsx");
    expect(contents).toContain("setOrders(initialOrders)");
    expect(contents).toContain("[initialOrders, initialSummary, initialTotal]");
  });

  it("updates the expenses and counterparties lists from refreshed props", () => {
    expect(source("components/expenses/expenses-client.tsx")).toContain(
      "setExpenses(initialData.expenses)",
    );
    expect(source("components/counterparties/counterparties-client.tsx")).toContain(
      "setCounterparties(initial)",
    );
  });

  it("loads and renders counterparty and return reports", () => {
    const contents = source("components/reports/reports-client.tsx");
    expect(contents).toContain('fetchReport<typeof counterparties>("counterparties")');
    expect(contents).toContain('fetchReport<typeof returns>("returns")');
    expect(contents).toContain("counterparty.counterpartyId");
    expect(contents).toContain("item.returnPercent");
  });

  it("refreshes stale reports when the app becomes visible without browser caching", () => {
    const contents = source("components/reports/reports-client.tsx");
    expect(contents).toContain("5 * 60_000");
    expect(contents).toContain('cache: "no-store"');
    expect(contents).toContain('"visibilitychange"');
  });

  it("renders expense cards from current client data", () => {
    const contents = source("components/expenses/expenses-client.tsx");
    expect(contents).toContain("summarizeExpensesForMonth(expenses)");
    expect(contents).toContain("monthSummary.total");
    expect(contents).toContain("monthSummary.byCategory");
  });

  it("renders the expenses month summary as a donut without zero categories", () => {
    const contents = source("components/expenses/expenses-client.tsx");
    expect(contents).toContain("ExpenseMonthDonut");
    expect(contents).toContain("ResponsiveContainer");
    expect(contents).toContain("PieChart");
    expect(contents).toContain("filter((item) => item.amount > 0)");
    expect(contents).toContain("Все расходы");
    expect(contents).not.toContain("grid grid-cols-3 gap-2");
  });

  it("shows gross order amounts under the left dashboard cards", () => {
    const contents = source("app/(app)/dashboard/page.tsx");
    expect(contents).toContain("todayOrderAmount");
    expect(contents).toContain("weekOrderAmount");
    expect(contents).toContain("order.createdAt >= todayStart");
    expect(contents).toContain("createdAt: { gte: weekStart, lte: todayEnd }");
    expect(contents).not.toContain('"создано за день"');
    expect(contents).not.toContain('"создано за период"');
  });

  it("separates created orders from received sales in dashboard widgets", () => {
    const contents = source("app/(app)/dashboard/page.tsx");
    expect(contents).toContain('status: "RECEIVED"');
    expect(contents).toContain("order.receivedAt >= todayStart");
    expect(contents).toContain('label: "Получено сегодня"');
    expect(contents).toContain('label: "Получено за 7 дней"');
  });

  it("ranks top products by active orders instead of received sales", () => {
    const query = source("lib/dashboard/top-products-query.ts");
    const widget = source("components/dashboard/top-products-list.tsx");
    expect(query).toContain("buildTopProductsByOrders(orders, limit)");
    expect(widget).toContain("formatOrderCount(product.orders)");
    expect(query).toContain('status: { not: "CANCELLED" }');
    expect(query).toContain("product: { select: { imageUrl: true } }");
  });
});
