import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  buildTopProductsByOrders,
  normalizeTopProductName,
} from "@/lib/dashboard/top-products";

function order(
  productId: string,
  productNameSnapshot: string,
  items: Array<{ productId: string; productNameSnapshot: string }> = [],
) {
  return {
    productId,
    productNameSnapshot,
    product: { imageUrl: null },
    items: items.map((item) => ({ ...item, product: { imageUrl: null } })),
  };
}

describe("dashboard top products by orders", () => {
  it("combines separate Avito listings with the same normalized product name", () => {
    const result = buildTopProductsByOrders([
      order("listing-1", "Лонгслив"),
      order("listing-2", "  лонгслив  "),
      order("listing-3", "ЛОНГСЛИВ!"),
    ]);

    expect(result).toEqual([
      {
        id: "лонгслив",
        name: "Лонгслив",
        imageUrl: null,
        orders: 3,
      },
    ]);
  });

  it("counts a normalized product only once inside one multi-item order", () => {
    const result = buildTopProductsByOrders([
      order("legacy", "Другой товар", [
        { productId: "listing-1", productNameSnapshot: "Лонгслив" },
        { productId: "listing-2", productNameSnapshot: "Лонгслив." },
      ]),
    ]);

    expect(result[0].orders).toBe(1);
  });

  it("normalizes Russian spelling, punctuation and whitespace", () => {
    expect(normalizeTopProductName("  Чёрный—лонгслив! ")).toBe("черный лонгслив");
  });
});

describe("mobile dashboard layout", () => {
  it("keeps mobile dashboard rows inside the viewport", () => {
    const source = readFileSync(
      path.resolve(__dirname, "../app/(app)/dashboard/page.tsx"),
      "utf8",
    );
    const widgetSource = readFileSync(
      path.resolve(__dirname, "../components/dashboard/top-products-list.tsx"),
      "utf8",
    );

    expect(source).toContain("grid-cols-[auto_minmax(0,1fr)_minmax(4.75rem,auto)]");
    expect(widgetSource).toContain("grid-cols-[1.5rem_minmax(0,1fr)_minmax(4.5rem,auto)]");
    expect(source).toContain("const getOrderImageUrl");
    expect(source).toContain("item.imageUrls.length > 0");
    expect(source).toContain("CRM Avito");
    expect(source).toContain("Главная · рабочая сводка");
    expect(source).toContain('className="inline-flex h-11 w-11 touch-manipulation');
    expect(source).toMatch(
      /alt=\{order\.productNameSnapshot\}[\s\S]*?width=\{44\}[\s\S]*?height=\{44\}[\s\S]*?unoptimized/,
    );
  });

  it("refreshes only the top-products widget while the dashboard is visible", () => {
    const widgetSource = readFileSync(
      path.resolve(__dirname, "../components/dashboard/top-products-list.tsx"),
      "utf8",
    );
    const routeSource = readFileSync(
      path.resolve(__dirname, "../app/api/dashboard/top-products/route.ts"),
      "utf8",
    );

    expect(widgetSource).toContain('fetch("/api/dashboard/top-products", { cache: "no-store" })');
    expect(widgetSource).toContain("window.setInterval");
    expect(widgetSource).toContain('document.visibilityState === "visible"');
    expect(widgetSource).toContain('removeEventListener("visibilitychange"');
    expect(routeSource).toContain('"cache-control": "no-store"');
    expect(routeSource).toContain("getDashboardTopProducts");
  });
});
