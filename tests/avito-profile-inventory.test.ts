import { describe, expect, it, vi } from "vitest";
import { fetchAvitoProfileInventory } from "@/lib/avito/profile-inventory";

describe("Avito profile inventory", () => {
  it("maps active autoload ads from reports and classifies unresolved items as manual", async () => {
    const fetchFn = vi.fn(async (input: URL | RequestInfo) => {
      const url = String(input);
      if (url === "https://api.avito.ru/token/") return Response.json({ access_token: "token" });
      if (url.includes("/core/v1/items?")) {
        if (new URL(url).searchParams.get("page") !== "1") return Response.json({ resources: [] });
        return Response.json({ resources: [
          { id: 100, status: "active", title: "Футболка Existing", address: "Москва" },
          { id: 200, status: "active", title: "Manual listing", address: "Москва" },
        ] });
      }
      if (url.endsWith("/autoload/v4/uploads/current")) return Response.json({ upload_id: 55 });
      if (url.endsWith("/autoload/v4/uploads/last_successful")) return new Response("", { status: 404 });
      if (url.includes("/autoload/v4/uploads?")) return Response.json({ uploads: [] });
      if (url.includes("/autoload/v2/reports/55/items")) {
        return Response.json({ items: [{ ad_id: "SKU-old", avito_id: 100, avito_status: "active" }] });
      }
      if (url.endsWith("/core/v1/accounts/self")) return Response.json({ id: 381462505 });
      if (url.endsWith("/core/v1/accounts/381462505/items/200")) return Response.json({ status: "active" });
      throw new Error(`Unexpected URL: ${url}`);
    }) as unknown as typeof fetch;

    const result = await fetchAvitoProfileInventory(
      { clientId: "client", clientSecret: "secret" },
      { fetchFn, sleepFn: async () => undefined },
    );

    expect(result).toMatchObject({ activeAds: 2, autoloadAds: 1, manualAds: 1 });
    expect(result.activeListings).toEqual([
      { avitoId: "100", externalId: "SKU-old", title: "Футболка Existing", address: "Москва" },
      { avitoId: "200", externalId: null, title: "Manual listing", address: "Москва" },
    ]);
  });
});
