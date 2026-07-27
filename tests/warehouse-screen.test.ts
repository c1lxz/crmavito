import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("warehouse screen", () => {
  it("shows available and archived returned goods without extra statuses", () => {
    const page = readFileSync(
      path.resolve(__dirname, "../app/(app)/warehouse/page.tsx"),
      "utf8",
    );
    const client = readFileSync(
      path.resolve(__dirname, "../components/warehouse/warehouse-client.tsx"),
      "utf8",
    );

    expect(page).toContain('state: WarehouseItem["state"]');
    expect(page).toContain('"ARCHIVED"');
    expect(page).toContain('"AVAILABLE"');
    expect(client).toContain("На складе");
    expect(client).toContain("Архив");
    expect(client).not.toContain("Зарезервировано");
    expect(client).toContain("Товар, трек или номер заказа");
    expect(client).toContain(
      "После выбора складского товара в новом заказе запись автоматически переместится сюда.",
    );
  });

  it("is reachable from desktop, mobile and returns navigation", () => {
    const desktop = readFileSync(
      path.resolve(__dirname, "../components/layout/desktop-sidebar.tsx"),
      "utf8",
    );
    const mobile = readFileSync(
      path.resolve(__dirname, "../components/layout/bottom-nav.tsx"),
      "utf8",
    );
    const returns = readFileSync(
      path.resolve(__dirname, "../components/returns/returns-client.tsx"),
      "utf8",
    );

    expect(desktop).toContain('href: "/pc/warehouse"');
    expect(mobile).toContain('href: "/m/warehouse"');
    expect(returns).toContain('<Link href="/warehouse">');
  });
});
