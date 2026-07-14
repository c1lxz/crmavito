import { describe, expect, it, vi } from "vitest";
import { fetchAvitoStockItems, updateAvitoStocks } from "@/lib/avito/stocks";

const credentials = { clientId: "client", clientSecret: "secret" };

describe("Avito stock management", () => {
  it("loads items and merges stock quantities by item id", async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const fetchFn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      const href = String(url);
      if (href.includes("/token")) {
        return Response.json({ access_token: "token", expires_in: 3600, token_type: "Bearer" });
      }
      if (href.includes("/core/v1/items") && new URL(href).searchParams.get("page") === "1") {
        return Response.json({
          resources: [
            {
              id: 101,
              title: "Футболка",
              price: { value: 1500 },
              status: "active",
              url: "https://www.avito.ru/item/101",
              images: [{ url: "https://01.avito.st/image/101.jpg" }],
            },
          ],
        });
      }
      if (href.includes("/core/v1/items") && new URL(href).searchParams.get("page") === "2") {
        return Response.json({ resources: [] });
      }
      if (href.includes("/stock-management/1/info")) {
        return Response.json({
          stocks: [
            {
              item_id: 101,
              quantity: 7,
              is_multiple: true,
              is_out_of_stock: false,
              is_unlimited: false,
            },
          ],
        });
      }
      return new Response("unexpected", { status: 500 });
    }) as unknown as typeof fetch;

    const items = await fetchAvitoStockItems(credentials, {
      fetchFn,
      sleepFn: async () => undefined,
    });

    expect(items).toEqual([
      expect.objectContaining({
        itemId: "101",
        title: "Футболка",
        price: 1500,
        quantity: 7,
        isMultiple: true,
      }),
    ]);
    expect(calls.find((call) => call.url.includes("/stock-management/1/info"))?.init?.body).toBe(
      JSON.stringify({ item_ids: [101] }),
    );
  });

  it("updates quantities through stock-management payload", async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const fetchFn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      if (String(url).includes("/token")) {
        return Response.json({ access_token: "token", expires_in: 3600, token_type: "Bearer" });
      }
      if (String(url).includes("/stock-management/1/stocks")) {
        return Response.json({ stocks: [{ item_id: 101, success: true }] });
      }
      return new Response("unexpected", { status: 500 });
    }) as unknown as typeof fetch;

    const result = await updateAvitoStocks(
      credentials,
      [{ itemId: "101", quantity: 5 }],
      { fetchFn, sleepFn: async () => undefined },
    );

    expect(result).toEqual([{ item_id: 101, success: true }]);
    expect(calls.find((call) => call.url.includes("/stock-management/1/stocks"))?.init?.body).toBe(
      JSON.stringify({ stocks: [{ item_id: 101, quantity: 5 }] }),
    );
  });
});
