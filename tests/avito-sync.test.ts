import { describe, expect, it, vi } from "vitest";
import { fetchAllAvitoItems, fetchWithRetry } from "@/lib/avito/sync";

describe("Avito synchronization transport", () => {
  it("retries transient HTTP and network failures", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(new Response("busy", { status: 503 }))
      .mockRejectedValueOnce(new Error("temporary network failure"))
      .mockResolvedValueOnce(new Response("ok", { status: 200 })) as unknown as typeof fetch;
    const sleepFn = vi.fn(async () => undefined);

    const response = await fetchWithRetry("https://example.test", {}, {
      fetchFn,
      sleepFn,
      attempts: 4,
    });

    expect(response.status).toBe(200);
    expect(fetchFn).toHaveBeenCalledTimes(3);
    expect(sleepFn).toHaveBeenCalledTimes(2);
  });

  it("continues after a short page and stops only on an empty page", async () => {
    const pages: Record<string, unknown> = {
      "1": { resources: [{ id: 1, title: "One", status: "active" }] },
      "2": { resources: [{ id: 2, title: "Two", status: "active" }] },
      "3": { resources: [] },
    };
    const fetchFn = vi.fn(async (url: string | URL | Request) => {
      const page = new URL(String(url)).searchParams.get("page") ?? "";
      return Response.json(pages[page]);
    }) as unknown as typeof fetch;

    const result = await fetchAllAvitoItems("token", {
      fetchFn,
      sleepFn: async () => undefined,
      perPage: 100,
      maxPages: 5,
    });

    expect(result.items.map((item) => item.id)).toEqual([1, 2]);
    expect(result.statusCounts).toEqual({ active: 2 });
    expect(fetchFn).toHaveBeenCalledTimes(3);
  });

  it("deduplicates repeated items across pages", async () => {
    const fetchFn = vi.fn(async (url: string | URL | Request) => {
      const page = new URL(String(url)).searchParams.get("page");
      return Response.json({
        resources:
          page === "1"
            ? [{ id: 1, title: "Old" }]
            : page === "2"
              ? [{ id: 1, title: "Fresh" }]
              : [],
      });
    }) as unknown as typeof fetch;

    const result = await fetchAllAvitoItems("token", {
      fetchFn,
      sleepFn: async () => undefined,
      maxPages: 5,
    });

    expect(result.items).toHaveLength(1);
    expect(result.items[0].title).toBe("Fresh");
  });
});
