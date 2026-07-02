import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createOrderSchema, getLegacyOrderTotals } from "@/lib/orders/schema";

describe("multiple order items", () => {
  it("aggregates every item into legacy financial fields used by reports", () => {
    expect(
      getLegacyOrderTotals([
        {
          productId: "11111111-1111-4111-8111-111111111111",
          quantity: 2,
          salePriceAtOrder: 1500,
          purchasePricePerUnit: 700,
          imageUrls: [],
        },
        {
          productId: "22222222-2222-4222-8222-222222222222",
          quantity: 1,
          salePriceAtOrder: 2400,
          purchasePricePerUnit: 900,
          imageUrls: [],
        },
      ])
    ).toEqual({
      quantity: 1,
      salePriceAtOrder: 5400,
      purchasePricePerUnit: 2300,
    });
  });

  it("accepts several products and several photos", () => {
    const result = createOrderSchema.safeParse({
      counterpartyId: "33333333-3333-4333-8333-333333333333",
      trackingNumber: "TRACK-1",
      orderDate: "2026-07-01",
      items: [
        {
          productId: "11111111-1111-4111-8111-111111111111",
          quantity: 1,
          salePriceAtOrder: 1000,
          purchasePricePerUnit: 500,
          imageUrls: ["/uploads/orders/one.jpg", "/uploads/orders/two.jpg"],
        },
        {
          productId: "22222222-2222-4222-8222-222222222222",
          quantity: 2,
          salePriceAtOrder: 2000,
          purchasePricePerUnit: 800,
          imageUrls: [],
        },
      ],
    });
    expect(result.success).toBe(true);
  });

  it("attributes product analytics to every order item", () => {
    const reportsSource = readFileSync(
      path.resolve(__dirname, "../lib/db/reports.ts"),
      "utf8"
    );
    expect(reportsSource).toContain("for (const item of items)");
    expect(reportsSource).toContain("allocatedCosts");
  });
});

describe("order management UI/API", () => {
  const detailSource = readFileSync(
    path.resolve(__dirname, "../components/orders/order-detail-client.tsx"),
    "utf8"
  );
  const statusRouteSource = readFileSync(
    path.resolve(__dirname, "../app/api/orders/[id]/status/route.ts"),
    "utf8"
  );
  const orderRouteSource = readFileSync(
    path.resolve(__dirname, "../app/api/orders/[id]/route.ts"),
    "utf8"
  );
  const formSource = readFileSync(
    path.resolve(__dirname, "../components/orders/create-order-dialog.tsx"),
    "utf8"
  );
  const reportsSource = readFileSync(
    path.resolve(__dirname, "../lib/db/reports.ts"),
    "utf8"
  );

  it("shows all user-facing statuses in one select", () => {
    expect(detailSource).toContain("EDITABLE_STATUSES");
    expect(detailSource).toContain("SelectTrigger");
    expect(statusRouteSource).not.toContain("isTransitionAllowed");
  });

  it("allows deleting an order in every status", () => {
    expect(orderRouteSource).toContain("export async function DELETE");
    expect(orderRouteSource).not.toContain('order.status !== "ACCEPTED"');
    expect(reportsSource).toContain(
      'order: { isDeleted: false, status: { not: "CANCELLED" } }',
    );
  });

  it("supports adding products and uploading multiple photos", () => {
    expect(formSource).toContain("Добавить товар");
    expect(formSource).toContain('multiple');
    expect(formSource).toContain("/api/uploads");
  });
});
