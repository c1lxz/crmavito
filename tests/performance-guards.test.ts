import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const source = (file: string) => readFileSync(path.resolve(__dirname, "..", file), "utf8");

describe("performance guards", () => {
  it("paginates the orders page and keeps search server-side", () => {
    const page = source("app/(app)/orders/page.tsx");
    const list = source("lib/orders/list.ts");
    const client = source("components/orders/orders-client.tsx");
    expect(page).toContain("getOrderList({");
    expect(list).toContain("ORDER_LIST_PAGE_SIZE = 100");
    expect(list).toContain("skip: (safePage - 1) * safePageSize");
    expect(client).toContain('params.set("q", search.trim())');
    expect(client).toContain("loadMoreOrders");
  });

  it("does not prefetch every heavy navigation route", () => {
    expect(source("components/ui/dock.tsx")).toContain("prefetch={false}");
    expect(source("components/layout/desktop-sidebar.tsx")).toContain("prefetch={false}");
  });

  it("does not reload the entire app every minute", () => {
    const autoRefresh = source("components/layout/auto-refresh.tsx");
    expect(autoRefresh).toContain("window.setInterval(checkDay");
    expect(autoRefresh).not.toContain("window.setInterval(refresh");
    expect(autoRefresh).toContain("STALE_AFTER_MS");
  });

  it("selects only fields required by the dashboard", () => {
    const dashboard = source("app/(app)/dashboard/page.tsx");
    expect(dashboard).toContain("select: financeSelect");
    expect(dashboard).not.toContain("include: {\n          product: true");
  });
});
