import { describe, expect, it, vi } from "vitest";
import {
  buildRecentDateRange,
  fetchAvitoAdsAnalytics,
  parseAvitoStatsItems,
} from "@/lib/avito/ads-analytics";

const credentials = { clientId: "client", clientSecret: "secret" };

describe("Avito ads analytics", () => {
  it("builds an inclusive recent date range", () => {
    expect(buildRecentDateRange(3, new Date("2026-07-18T12:00:00Z"))).toEqual({
      dateFrom: "2026-07-16",
      dateTo: "2026-07-18",
    });
  });

  it("parses Avito stats keyed by item id and sums daily rows", () => {
    const stats = parseAvitoStatsItems({
      result: {
        items: {
          101: [
            { date: "2026-07-16", uniqViews: 4, uniqContacts: 1, uniqFavorites: 2 },
            { date: "2026-07-17", uniqViews: 6, uniqContacts: 3, uniqFavorites: 5 },
          ],
        },
      },
    });

    expect(stats.get("101")).toMatchObject({
      uniqViews: 10,
      uniqContacts: 4,
      uniqFavorites: 7,
    });
  });

  it("parses Avito stats array items with nested daily stats", () => {
    const stats = parseAvitoStatsItems({
      result: {
        items: [
          {
            itemId: 101,
            stats: [
              { date: "2026-07-16", uniqViews: 4, uniqContacts: 1, uniqFavorites: 2 },
              { date: "2026-07-17", uniqViews: 6, uniqContacts: 3, uniqFavorites: 5 },
            ],
          },
          { itemId: 202, stats: [] },
        ],
      },
    });

    expect(stats.get("101")).toMatchObject({
      uniqViews: 10,
      uniqContacts: 4,
      uniqFavorites: 7,
    });
    expect(stats.get("202")).toMatchObject({
      uniqViews: 0,
      uniqContacts: 0,
      uniqFavorites: 0,
    });
  });

  it("loads own ads and ranks analytics counters", async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const fetchFn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      const href = String(url);
      if (href.includes("/token")) {
        return Response.json({ access_token: "token", expires_in: 3600, token_type: "Bearer" });
      }
      if (href.includes("/core/v1/accounts/self")) {
        return Response.json({ id: 42, name: "Основной профиль" });
      }
      if (href.includes("/core/v1/items") && new URL(href).searchParams.get("page") === "1") {
        return Response.json({
          resources: [
            { id: 101, title: "Футболка", status: "active", url: "https://www.avito.ru/item_101" },
            { id: 202, title: "Худи", status: "active", url: "https://www.avito.ru/item_202" },
          ],
        });
      }
      if (href.includes("/core/v1/items") && new URL(href).searchParams.get("page") === "2") {
        return Response.json({ resources: [] });
      }
      if (href.includes("/stats/v1/accounts/42/items")) {
        return Response.json({
          result: {
            items: {
              101: [{ uniqViews: 8, uniqContacts: 1, uniqFavorites: 3 }],
              202: [{ uniqViews: 21, uniqContacts: 5, uniqFavorites: 2 }],
            },
          },
        });
      }
      return new Response("unexpected", { status: 500 });
    }) as unknown as typeof fetch;

    const result = await fetchAvitoAdsAnalytics(
      { profileId: "profile-1", credentials, periodDays: 3 },
      { fetchFn, sleepFn: async () => undefined },
    );

    expect(result.total).toMatchObject({
      ads: 2,
      views: 29,
      contacts: 6,
      favorites: 5,
    });
    expect(result.items[0]).toMatchObject({ itemId: "202", views: 21, contacts: 5 });
    expect(calls.find((call) => call.url.includes("/stats/v1/accounts/42/items"))?.init?.body).toContain("uniqViews");
  });
});
