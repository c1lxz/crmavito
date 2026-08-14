import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { vi } from "vitest";
import { completeOrderSave } from "@/lib/orders/save-client";

const source = (file: string) =>
  readFileSync(path.resolve(__dirname, `../${file}`), "utf8");

describe("order creation refresh", () => {
  it("updates the order list locally instead of refreshing the RSC page", () => {
    const dialog = source("components/orders/create-order-dialog.tsx");
    const list = source("components/orders/orders-client.tsx");
    const route = source("app/api/orders/route.ts");

    expect(dialog).toContain("onSaved?: (order: OrderListItem) => void");
    expect(dialog).toContain("completeOrderSave(savedOrder, onSaved");
    expect(list).toContain("onSaved={handleOrderCreated}");
    expect(list).toContain("setOrders((current) => [order, ...current.filter");
    expect(route).toContain("getOrderListItem(order.id)");
  });

  it("does not report a successful save as an API error when refresh fails", () => {
    const dialog = source("components/orders/create-order-dialog.tsx");
    const requestCatch = dialog.indexOf("} catch (error) {");
    const successToast = dialog.indexOf('toast({ title: isEditing ? "Заказ обновлён" : "Заказ создан" })');

    expect(requestCatch).toBeGreaterThan(-1);
    expect(successToast).toBeGreaterThan(requestCatch);
  });

  it("handles two consecutive saves without starting the failing WebView refresh", () => {
    const saved: Array<{ id: string }> = [];
    const refresh = vi.fn(() => {
      throw new TypeError("Load failed");
    });

    expect(() => {
      completeOrderSave({ id: "order-1" }, (order) => saved.push(order), refresh);
      completeOrderSave({ id: "order-2" }, (order) => saved.push(order), refresh);
    }).not.toThrow();

    expect(saved).toEqual([{ id: "order-1" }, { id: "order-2" }]);
    expect(refresh).not.toHaveBeenCalled();
  });

  it("does not surface refresh failures after an already successful edit", () => {
    const refreshError = vi.fn();

    expect(() =>
      completeOrderSave(
        { id: "order-1" },
        undefined,
        () => {
          throw new TypeError("Load failed");
        },
        refreshError,
      ),
    ).not.toThrow();
    expect(refreshError).toHaveBeenCalledWith(expect.any(TypeError));
  });
});
