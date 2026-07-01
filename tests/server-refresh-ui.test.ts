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
    expect(contents).toContain("[initialOrders]");
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

  it("polls report APIs every minute without browser caching", () => {
    const contents = source("components/reports/reports-client.tsx");
    expect(contents).toContain("window.setInterval");
    expect(contents).toContain("60_000");
    expect(contents).toContain('cache: "no-store"');
    expect(contents).toContain('"visibilitychange"');
  });

  it("renders expense cards from current client data", () => {
    const contents = source("components/expenses/expenses-client.tsx");
    expect(contents).toContain("summarizeExpensesForMonth(expenses)");
    expect(contents).toContain("monthSummary.total");
    expect(contents).toContain("monthSummary.byCategory");
  });

  it("shows gross order amounts under the left dashboard cards", () => {
    const contents = source("app/(app)/dashboard/page.tsx");
    expect(contents).toContain("todayOrderAmount");
    expect(contents).toContain("weekOrderAmount");
    expect(contents).not.toContain('"создано за день"');
    expect(contents).not.toContain('"создано за период"');
  });
});
