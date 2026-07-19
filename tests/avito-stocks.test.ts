import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { fetchAvitoStockItems, fetchAvitoStockItemsResult, getAvitoStockToken, updateAvitoStocks } from "@/lib/avito/stocks";
import { fetchAvitoAccountProfile } from "@/lib/avito/profile";
import { fetchAvitoItemsPage } from "@/lib/avito/sync";

const credentials = { clientId: "client", clientSecret: "secret" };
const stocksRouteSource = readFileSync(path.resolve(__dirname, "../app/api/avito/stocks/route.ts"), "utf8");
const stocksPageRouteSource = readFileSync(path.resolve(__dirname, "../app/api/avito/stocks/page/route.ts"), "utf8");
const stocksClientSource = readFileSync(path.resolve(__dirname, "../components/settings/stocks-client.tsx"), "utf8");

describe("Avito stock management", () => {
  it("loads a single Avito listing page with explicit paging params", async () => {
    const fetchFn = vi.fn(async (url: string | URL | Request) => {
      const href = String(url);
      expect(new URL(href).searchParams.get("page")).toBe("2");
      expect(new URL(href).searchParams.get("per_page")).toBe("10");
      expect(new URL(href).searchParams.get("status")).toBe("active");
      return Response.json({
        resources: [
          { id: 20, title: "Second page first" },
          { id: 21, title: "Second page second" },
        ],
      });
    }) as unknown as typeof fetch;

    const result = await fetchAvitoItemsPage("token", {
      fetchFn,
      sleepFn: async () => undefined,
      page: 2,
      perPage: 10,
      status: "active",
    });

    expect(result.items.map((item) => item.id)).toEqual([20, 21]);
  });

  it("uses short paginated requests for the stock list UI", () => {
    expect(stocksPageRouteSource).toContain("fetchAvitoItemsPage");
    expect(stocksPageRouteSource).toContain("avitoListItemToStockItem");
    expect(stocksPageRouteSource).toContain("maxDuration = 60");
    expect(stocksPageRouteSource).toContain("attempts: 1");
    expect(stocksPageRouteSource).toContain("requestAttempts: 1");
    expect(stocksPageRouteSource).toContain("requestTimeoutMs: 20_000");
    expect(stocksClientSource).toContain("/api/avito/stocks/page");
    expect(stocksClientSource).toContain("loadListingPages");
    expect(stocksClientSource).toContain("listingProgress");
    expect(stocksClientSource).toContain("timeoutSignal(35_000)");
    expect(stocksClientSource).toContain("const newItems = pageItems.filter");
    expect(stocksClientSource).toContain("if (newItems.length === 0)");
    expect(stocksClientSource).toContain("emptyPages >= 3");
    expect(stocksClientSource).toContain("Avito не отдал конец списка объявлений");
    expect(stocksClientSource).not.toContain("Avito pagination exceeded");
    expect(stocksClientSource).toContain("const chunkSize = 10");
  });

  it("can skip listing page retries for the stock list UI", async () => {
    let calls = 0;
    const fetchFn = vi.fn(async () => {
      calls += 1;
      return Response.json({ error: "busy" }, { status: 504 });
    }) as unknown as typeof fetch;

    await expect(
      fetchAvitoItemsPage("token", {
        fetchFn,
        sleepFn: async () => undefined,
        page: 1,
        perPage: 25,
        requestAttempts: 1,
      }),
    ).rejects.toThrow("504");

    expect(calls).toBe(1);
  });

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

  it("keeps stock items in the Avito profile listing order", async () => {
    const fetchFn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const href = String(url);
      if (href.includes("/token")) {
        return Response.json({ access_token: "token", expires_in: 3600, token_type: "Bearer" });
      }
      if (href.includes("/core/v1/items") && new URL(href).searchParams.get("page") === "1") {
        return Response.json({
          resources: [
            { id: 301, title: "Первое в профиле", price: { value: 3000 }, status: "active" },
            { id: 101, title: "Второе в профиле", price: { value: 1000 }, status: "active" },
          ],
        });
      }
      if (href.includes("/core/v1/items") && new URL(href).searchParams.get("page") === "2") {
        return Response.json({
          resources: [{ id: 202, title: "Третье в профиле", price: { value: 2000 }, status: "active" }],
        });
      }
      if (href.includes("/core/v1/items") && new URL(href).searchParams.get("page") === "3") {
        return Response.json({ resources: [] });
      }
      if (href.includes("/stock-management/1/info")) {
        const body = JSON.parse(String(init?.body)) as { item_ids: number[] };
        return Response.json({
          stocks: [...body.item_ids]
            .reverse()
            .map((itemId) => ({ item_id: itemId, quantity: itemId })),
        });
      }
      return new Response("unexpected", { status: 500 });
    }) as unknown as typeof fetch;

    const result = await fetchAvitoStockItemsResult(credentials, {
      fetchFn,
      sleepFn: async () => undefined,
    });

    expect(result.items.map((item) => item.itemId)).toEqual(["301", "101", "202"]);
    expect(result.items.map((item) => item.quantity)).toEqual([301, 101, 202]);
  });

  it("loads stock listings slowly with explicit active profile order", async () => {
    const listingUrls: URL[] = [];
    const fetchFn = vi.fn(async (url: string | URL | Request) => {
      const href = String(url);
      if (href.includes("/token")) {
        return Response.json({ access_token: "token", expires_in: 3600, token_type: "Bearer" });
      }
      if (href.includes("/core/v1/items")) {
        const parsed = new URL(href);
        listingUrls.push(parsed);
        return Response.json({
          resources: parsed.searchParams.get("page") === "1"
            ? [{ id: 101, title: "Первое", price: { value: 1000 }, status: "active" }]
            : [],
        });
      }
      return new Response("unexpected", { status: 500 });
    }) as unknown as typeof fetch;

    const result = await fetchAvitoStockItemsResult(credentials, {
      fetchFn,
      sleepFn: async () => undefined,
      skipStocks: true,
      listingEmptyPagesToStop: 3,
    });

    expect(result.items.map((item) => item.itemId)).toEqual(["101"]);
    expect(listingUrls[0].searchParams.get("per_page")).toBe("25");
    expect(listingUrls[0].searchParams.get("status")).toBe("active");
    expect(listingUrls).toHaveLength(4);
  });

  it("returns ordered partial listings when Avito 504s after some pages", async () => {
    const fetchFn = vi.fn(async (url: string | URL | Request) => {
      const href = String(url);
      if (href.includes("/token")) {
        return Response.json({ access_token: "token", expires_in: 3600, token_type: "Bearer" });
      }
      if (href.includes("/core/v1/items") && new URL(href).searchParams.get("page") === "1") {
        return Response.json({
          resources: [
            { id: 301, title: "Первое", price: { value: 3000 }, status: "active" },
            { id: 101, title: "Второе", price: { value: 1000 }, status: "active" },
          ],
        });
      }
      if (href.includes("/core/v1/items") && new URL(href).searchParams.get("page") === "2") {
        return new Response("504 Gateway Time-out nginx", { status: 504 });
      }
      return new Response("unexpected", { status: 500 });
    }) as unknown as typeof fetch;

    const result = await fetchAvitoStockItemsResult(credentials, {
      fetchFn,
      sleepFn: async () => undefined,
      skipStocks: true,
      listingAllowPartial: true,
      listingEmptyPagesToStop: 3,
    });

    expect(result.items.map((item) => item.itemId)).toEqual(["301", "101"]);
    expect(result.warning).toContain("Avito временно прервал загрузку списка объявлений");
    expect(result.warning).toContain("504");
  });

  it("uses fallback listing sizes in the stocks route", () => {
    expect(stocksRouteSource).toContain("listingPerPage: 25");
    expect(stocksRouteSource).toContain("listingPerPage: 10");
    expect(stocksRouteSource).toContain("listingPerPage: 5");
    expect(stocksRouteSource).toContain("listingAllowPartial: true");
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

  it("does not keep retrying stock updates for too long", async () => {
    const stockStatuses = [429, 504, 200];
    let stockCalls = 0;
    const fetchFn = vi.fn(async (url: string | URL | Request) => {
      if (String(url).includes("/token")) {
        return Response.json({ access_token: "token", expires_in: 3600, token_type: "Bearer" });
      }
      if (String(url).includes("/stock-management/1/stocks")) {
        stockCalls += 1;
        const status = stockStatuses.shift() ?? 200;
        if (status !== 200) return Response.json({ error: "busy" }, { status });
        return Response.json({ stocks: [{ item_id: 101, success: true }] });
      }
      return new Response("unexpected", { status: 500 });
    }) as unknown as typeof fetch;

    await expect(
      updateAvitoStocks(
        credentials,
        [{ itemId: "101", quantity: 5 }],
        { fetchFn, sleepFn: async () => undefined, updateAttempts: 2 },
      ),
    ).rejects.toThrow("busy");

    expect(stockCalls).toBe(2);
  });

  it("loads items when Avito returns an empty stock info body", async () => {
    const fetchFn = vi.fn(async (url: string | URL | Request) => {
      const href = String(url);
      if (href.includes("/token")) {
        return Response.json({ access_token: "token", expires_in: 3600, token_type: "Bearer" });
      }
      if (href.includes("/core/v1/items") && new URL(href).searchParams.get("page") === "1") {
        return Response.json({
          resources: [{ id: 101, title: "Футболка", price: { value: 1500 }, status: "active" }],
        });
      }
      if (href.includes("/core/v1/items") && new URL(href).searchParams.get("page") === "2") {
        return Response.json({ resources: [] });
      }
      if (href.includes("/stock-management/1/info")) {
        return Response.json({});
      }
      return new Response("unexpected", { status: 500 });
    }) as unknown as typeof fetch;

    await expect(
      fetchAvitoStockItems(credentials, {
        fetchFn,
        sleepFn: async () => undefined,
      }),
    ).resolves.toEqual([
      expect.objectContaining({
        itemId: "101",
        quantity: null,
        isOutOfStock: false,
      }),
    ]);
  });

  it("warns without raw Avito JSON when stock loading is rate limited", async () => {
    const fetchFn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const href = String(url);
      if (href.includes("/token")) {
        return Response.json({ access_token: "token", expires_in: 3600, token_type: "Bearer" });
      }
      if (href.includes("/core/v1/items") && new URL(href).searchParams.get("page") === "1") {
        return Response.json({
          resources: Array.from({ length: 11 }, (_, index) => ({
            id: index + 1,
            title: `Товар ${index + 1}`,
            price: { value: 1000 },
            status: "active",
          })),
        });
      }
      if (href.includes("/core/v1/items") && new URL(href).searchParams.get("page") === "2") {
        return Response.json({ resources: [] });
      }
      if (href.includes("/stock-management/1/info")) {
        const body = JSON.parse(String(init?.body)) as { item_ids: number[] };
        if (body.item_ids.includes(11)) return Response.json({}, { status: 429 });
        return Response.json({
          stocks: body.item_ids.map((itemId) => ({ item_id: itemId, quantity: 3 })),
        });
      }
      return new Response("unexpected", { status: 500 });
    }) as unknown as typeof fetch;

    const result = await fetchAvitoStockItemsResult(credentials, {
      fetchFn,
      sleepFn: async () => undefined,
    });

    expect(result.items).toHaveLength(11);
    expect(result.warning).toContain("Avito ограничил частоту запросов остатков");
    expect(result.warning).not.toContain("{}");
  });

  it("stops stock loading when Avito stops returning stock arrays", async () => {
    let stockRequests = 0;
    const fetchFn = vi.fn(async (url: string | URL | Request) => {
      const href = String(url);
      if (href.includes("/token")) {
        return Response.json({ access_token: "token", expires_in: 3600, token_type: "Bearer" });
      }
      if (href.includes("/core/v1/items") && new URL(href).searchParams.get("page") === "1") {
        return Response.json({
          resources: Array.from({ length: 31 }, (_, index) => ({
            id: index + 1,
            title: `Товар ${index + 1}`,
            price: { value: 1000 },
            status: "active",
          })),
        });
      }
      if (href.includes("/core/v1/items") && new URL(href).searchParams.get("page") === "2") {
        return Response.json({ resources: [] });
      }
      if (href.includes("/stock-management/1/info")) {
        stockRequests += 1;
        if (stockRequests === 1) {
          return Response.json({ stocks: [{ item_id: 1, quantity: 2 }] });
        }
        return Response.json({});
      }
      return new Response("unexpected", { status: 500 });
    }) as unknown as typeof fetch;

    const result = await fetchAvitoStockItemsResult(credentials, {
      fetchFn,
      sleepFn: async () => undefined,
    });

    expect(result.items).toHaveLength(31);
    expect(stockRequests).toBe(2);
    expect(result.warning).toContain("Avito не отдал данные остатков");
  });

  it("splits large stock updates into Avito-sized batches", async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const fetchFn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      if (String(url).includes("/token")) {
        return Response.json({ access_token: "token", expires_in: 3600, token_type: "Bearer" });
      }
      if (String(url).includes("/stock-management/1/stocks")) {
        const body = JSON.parse(String(init?.body)) as { stocks: { item_id: number }[] };
        return Response.json({ stocks: body.stocks.map((stock) => ({ item_id: stock.item_id, success: true })) });
      }
      return new Response("unexpected", { status: 500 });
    }) as unknown as typeof fetch;

    const updates = Array.from({ length: 450 }, (_, index) => ({
      itemId: String(index + 1),
      quantity: 8,
    }));

    const result = await updateAvitoStocks(credentials, updates, {
      fetchFn,
      sleepFn: async () => undefined,
    });

    const stockCalls = calls.filter((call) => call.url.includes("/stock-management/1/stocks"));
    expect(stockCalls).toHaveLength(3);
    expect(JSON.parse(String(stockCalls[0].init?.body)).stocks).toHaveLength(200);
    expect(JSON.parse(String(stockCalls[1].init?.body)).stocks).toHaveLength(200);
    expect(JSON.parse(String(stockCalls[2].init?.body)).stocks).toHaveLength(50);
    expect(result).toHaveLength(450);
  });

  it("explains unauthorized_client token failures", async () => {
    const fetchFn = vi.fn(async (url: string | URL | Request) => {
      if (String(url).includes("/token")) {
        return Response.json({ error: "unauthorized_client" }, { status: 401 });
      }
      return new Response("unexpected", { status: 500 });
    }) as unknown as typeof fetch;

    await expect(
      getAvitoStockToken(credentials, {
        fetchFn,
        sleepFn: async () => undefined,
      }),
    ).rejects.toThrow("Avito не разрешил этим client_id/client_secret получать API-токен");
  });

  it("loads the current Avito account profile for credential history", async () => {
    const fetchFn = vi.fn(async (url: string | URL | Request) => {
      const href = String(url);
      if (href.includes("/token")) {
        return Response.json({ access_token: "token", expires_in: 3600, token_type: "Bearer" });
      }
      if (href.includes("/core/v1/accounts/self")) {
        return Response.json({ id: 42, name: "Основной профиль" });
      }
      return new Response("unexpected", { status: 500 });
    }) as unknown as typeof fetch;

    await expect(
      fetchAvitoAccountProfile(credentials, {
        fetchFn,
        sleepFn: async () => undefined,
      }),
    ).resolves.toEqual({ id: "42", name: "Основной профиль" });
  });
});
