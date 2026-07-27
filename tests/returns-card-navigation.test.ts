import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("returns card navigation", () => {
  it("opens the order from the return card body without a separate card button", () => {
    const source = readFileSync(path.resolve(__dirname, "../components/returns/returns-client.tsx"), "utf8");

    expect(source).toContain("ChevronRight");
    expect(source).toContain('href={`/orders/${ret.order.id}`}');
    expect(source).toContain('className="block"');
    expect(source).not.toContain(">Карточка<");
  });

  it("uses the same compact searchable product picker as order creation", () => {
    const source = readFileSync(path.resolve(__dirname, "../components/returns/returns-client.tsx"), "utf8");

    expect(source).toContain('htmlFor="return-product-search"');
    expect(source).toContain('placeholder="Начните вводить название..."');
    expect(source).toContain("matchesSearch(product.name, query)");
    expect(source).toContain('className="max-h-48 overflow-y-auto rounded-md border bg-card"');
    expect(source).toContain('className="min-w-0 flex-1 truncate"');
    expect(source).not.toContain('<SelectValue placeholder="Выберите товар"');
  });

  it("supports bulk deletion that removes returns from statistics", () => {
    const source = readFileSync(path.resolve(__dirname, "../components/returns/returns-client.tsx"), "utf8");
    const route = readFileSync(path.resolve(__dirname, "../app/api/returns/bulk-delete/route.ts"), "utf8");

    expect(source).toContain("/api/returns/bulk-delete");
    expect(source).toContain("deleteSelectedReturns");
    expect(source).toMatch(
      /\{selectedIds\.size > 0 && \(\s*<Button[\s\S]*?onClick=\{deleteSelectedReturns\}/,
    );
    expect(source).toContain("Больше не учитываются в статистике");
    expect(source).toContain("current.totalReturning - deletedReturns.filter");
    expect(source).toContain("current.totalReturned - deletedReturns.filter");
    expect(route).toContain("tx.return.deleteMany");
    expect(route).toContain("sourceReturnId: null");
  });

  it("uses the same visibility rules as reports and keeps returned history after warehouse reuse", () => {
    const page = readFileSync(path.resolve(__dirname, "../app/(app)/returns/page.tsx"), "utf8");

    expect(page).toContain('status: { not: "CANCELLED" as const }');
    expect(page).not.toMatch(
      /status:\s*"RETURNED",\s*usedByOrderItems:\s*\{\s*none:\s*\{\s*\}\s*\}/,
    );
  });
});
