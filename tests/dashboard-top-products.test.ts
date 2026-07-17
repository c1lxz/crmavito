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

    expect(source).toContain("grid-cols-[auto_minmax(0,1fr)_minmax(4.75rem,auto)]");
    expect(source).toContain("grid-cols-[1.5rem_minmax(0,1fr)_minmax(4.5rem,auto)]");
    expect(source).toContain("const getOrderImageUrl");
    expect(source).toContain("item.imageUrls.length > 0");
  });
});
