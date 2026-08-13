import { describe, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fetchAllAvitoItems, fetchWithRetry, normalizeProductName, syncAvitoProducts } from "@/lib/avito/sync";
import { __resetAvitoTokenCacheForTests } from "@/lib/avito/api";
import { __resetBotvImageCacheForTests } from "@/lib/botv/avito-image-cache";

describe("Avito synchronization transport", () => {
  it("normalizes visually equivalent product names for the shared catalog", () => {
    expect(normalizeProductName("  Футболка KY — Чёрная! ")).toBe("футболка ky черная");
    expect(normalizeProductName("ФУТБОЛКА KY - ЧЕРНАЯ")).toBe("футболка ky черная");
  });

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

  it("honors Retry-After on Avito rate limits", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(new Response("limited", {
        status: 429,
        headers: { "retry-after": "2" },
      }))
      .mockResolvedValueOnce(new Response("ok", { status: 200 })) as unknown as typeof fetch;
    const sleepFn = vi.fn(async () => undefined);

    const response = await fetchWithRetry("https://example.test", {}, {
      fetchFn,
      sleepFn,
      attempts: 2,
    });

    expect(response.status).toBe(200);
    expect(sleepFn).toHaveBeenCalledWith(2000);
  });

  it("creates fresh request options for every retry", async () => {
    const signals: AbortSignal[] = [];
    const fetchFn = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      signals.push(init?.signal as AbortSignal);
      if (signals.length === 1) throw new DOMException("timed out", "TimeoutError");
      return new Response("ok", { status: 200 });
    }) as unknown as typeof fetch;

    const response = await fetchWithRetry(
      "https://example.test",
      () => ({ signal: AbortSignal.timeout(30_000) }),
      { fetchFn, sleepFn: async () => undefined, attempts: 2 },
    );

    expect(response.status).toBe(200);
    expect(signals).toHaveLength(2);
    expect(signals[0]).not.toBe(signals[1]);
  });

  it("explains unauthorized_client token failures during product sync", async () => {
    const fetchFn = vi.fn(async (url: string | URL | Request) => {
      if (String(url).includes("/token")) {
        return Response.json({ error: "unauthorized_client" }, { status: 200 });
      }
      return new Response("unexpected", { status: 500 });
    }) as unknown as typeof fetch;
    const prisma = {
      product: {
        findMany: vi.fn(),
        upsert: vi.fn(),
        updateMany: vi.fn(),
      },
    } as unknown as Parameters<typeof syncAvitoProducts>[0];

    await expect(
      syncAvitoProducts(
        prisma,
        { clientId: "client", clientSecret: "secret" },
        { fetchFn, sleepFn: async () => undefined },
      ),
    ).rejects.toThrow("Avito не разрешил этим client_id/client_secret получать API-токен");
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

  it("can wait for consecutive empty pages before ending pagination", async () => {
    const pages: Record<string, unknown> = {
      "1": { resources: [{ id: 1, title: "One", status: "active" }] },
      "2": { resources: [] },
      "3": { resources: [{ id: 2, title: "Two", status: "active" }] },
      "4": { resources: [] },
      "5": { resources: [] },
    };
    const fetchFn = vi.fn(async (url: string | URL | Request) => {
      const page = new URL(String(url)).searchParams.get("page") ?? "";
      return Response.json(pages[page]);
    }) as unknown as typeof fetch;

    const result = await fetchAllAvitoItems("token", {
      fetchFn,
      sleepFn: async () => undefined,
      emptyPagesToStop: 2,
      maxPages: 6,
    });

    expect(result.items.map((item) => item.id)).toEqual([1, 2]);
    expect(fetchFn).toHaveBeenCalledTimes(5);
  });

  it("paces listing pages to avoid Avito rate limits", async () => {
    const fetchFn = vi.fn(async (url: string | URL | Request) => {
      const page = new URL(String(url)).searchParams.get("page");
      return Response.json({
        resources: page === "1" ? [{ id: 1, title: "One" }] : [],
      });
    }) as unknown as typeof fetch;
    const sleepFn = vi.fn(async () => undefined);

    await fetchAllAvitoItems("token", {
      fetchFn,
      sleepFn,
      pageDelayMs: 123,
      maxPages: 3,
    });

    expect(sleepFn).toHaveBeenCalledWith(123);
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

  it("links repeated titles from a profile to one shared product", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ access_token: "token" }))
      .mockResolvedValueOnce(Response.json({
        resources: [
          { id: 10, title: "Футболка KY", price: 100, images: [{ url: "https://10.avito.st/one.jpg" }] },
          { id: 11, title: "  ФУТБОЛКА KY! ", price: 120, images: [{ url: "https://10.avito.st/two.jpg" }] },
        ],
      }))
      .mockResolvedValueOnce(Response.json({ resources: [] })) as unknown as typeof fetch;
    const create = vi.fn(async () => ({ id: "shared-product" }));
    const listingUpsert = vi.fn(async () => ({}));
    const prisma = {
      product: {
        findMany: vi.fn()
          .mockResolvedValueOnce([])
          .mockResolvedValueOnce([]),
        findUnique: vi.fn(async () => null),
        create,
        update: vi.fn(async () => ({})),
      },
      productAvitoListing: {
        findMany: vi.fn(async () => []),
        upsert: listingUpsert,
        updateMany: vi.fn(async () => ({ count: 0 })),
      },
    } as unknown as Parameters<typeof syncAvitoProducts>[0];

    const result = await syncAvitoProducts(
      prisma,
      { clientId: "client", clientSecret: "secret" },
      { profileId: "profile-1", fetchFn, sleepFn: async () => undefined },
    );

    expect(create).toHaveBeenCalledTimes(1);
    expect(listingUpsert).toHaveBeenCalledTimes(2);
    expect(listingUpsert).toHaveBeenNthCalledWith(2, expect.objectContaining({
      create: expect.objectContaining({ productId: "shared-product", avitoItemId: "11" }),
    }));
    expect(result).toMatchObject({ created: 1, updated: 1, total: 2, profileId: "profile-1" });
  });

  it("can skip rate-limited per-item image requests during multi-profile sync", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ access_token: "token" }))
      .mockResolvedValueOnce(Response.json({ resources: [{ id: 21, title: "No image", price: 50 }] }))
      .mockResolvedValueOnce(Response.json({ resources: [] })) as unknown as typeof fetch;
    const prisma = {
      product: {
        findMany: vi.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([]),
        findUnique: vi.fn(async () => null),
        create: vi.fn(async () => ({ id: "product-21" })),
        update: vi.fn(async () => ({})),
      },
      productAvitoListing: {
        findMany: vi.fn(async () => []),
        upsert: vi.fn(async () => ({})),
        updateMany: vi.fn(async () => ({ count: 0 })),
      },
    } as unknown as Parameters<typeof syncAvitoProducts>[0];

    await syncAvitoProducts(
      prisma,
      { clientId: "client", clientSecret: "secret" },
      { profileId: "profile-fast", enrichMissingImages: false, fetchFn, sleepFn: async () => undefined },
    );

    expect(fetchFn).toHaveBeenCalledTimes(3);
  });

  it("fills missing images from item detail API during sync", async () => {
    const previousLimit = process.env.AVITO_SYNC_IMAGE_DETAIL_LIMIT;
    process.env.AVITO_SYNC_IMAGE_DETAIL_LIMIT = "1";
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ access_token: "token" }))
      .mockResolvedValueOnce(Response.json({
        resources: [
          { id: 1, title: "No list image", price: 100 },
          { id: 2, title: "Has list image", images: [{ url: "https://10.avito.st/image/list.jpg" }] },
        ],
      }))
      .mockResolvedValueOnce(Response.json({ resources: [] }))
      .mockResolvedValueOnce(Response.json({ images: [{ url: "https://20.avito.st/image/detail.jpg" }] }));
    const fetchFn = fetchMock as unknown as typeof fetch;
    const sleepFn = vi.fn(async () => undefined);
    const upsert = vi.fn(async () => ({}));
    const prisma = {
      product: {
        findMany: vi.fn(async () => []),
        upsert,
        updateMany: vi.fn(async () => ({ count: 0 })),
      },
    } as unknown as Parameters<typeof syncAvitoProducts>[0];

    try {
      const result = await syncAvitoProducts(
        prisma,
        { clientId: "client", clientSecret: "secret" },
        { fetchFn, sleepFn },
      );

      expect(result.imagesFound).toBe(2);
      expect(upsert).toHaveBeenCalledWith(expect.objectContaining({
        create: expect.objectContaining({
          avitoItemId: "1",
          imageUrl: "https://20.avito.st/image/detail.jpg",
        }),
      }));
      expect(upsert).toHaveBeenCalledWith(expect.objectContaining({
        create: expect.objectContaining({
          avitoItemId: "2",
          imageUrl: "https://10.avito.st/image/list.jpg",
        }),
      }));
    } finally {
      if (previousLimit === undefined) delete process.env.AVITO_SYNC_IMAGE_DETAIL_LIMIT;
      else process.env.AVITO_SYNC_IMAGE_DETAIL_LIMIT = previousLimit;
    }
  }, 10_000);

  it("fills missing images from BotV autoload XML before calling Avito detail API", async () => {
    const previousRoot = process.env.BOTV_WEB_SESSIONS_DIR;
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "crmavito-botv-"));
    const sessionDir = path.join(tempRoot, "session");
    await mkdir(sessionDir, { recursive: true });
    await writeFile(
      path.join(sessionDir, "avito.xml"),
      `<?xml version="1.0" encoding="UTF-8"?><Ads><Ad><Title>XML Product</Title><Images><Image url="http://crm.test/photo.jpeg"/></Images></Ad></Ads>`,
      "utf8",
    );
    process.env.BOTV_WEB_SESSIONS_DIR = tempRoot;
    __resetBotvImageCacheForTests();

    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ access_token: "token" }))
      .mockResolvedValueOnce(Response.json({ resources: [{ id: 7, title: "XML Product", price: 100 }] }))
      .mockResolvedValueOnce(Response.json({ resources: [] })) as unknown as typeof fetch;
    const upsert = vi.fn(async () => ({}));
    const prisma = {
      product: {
        findMany: vi.fn(async () => []),
        upsert,
        updateMany: vi.fn(async () => ({ count: 0 })),
      },
    } as unknown as Parameters<typeof syncAvitoProducts>[0];

    try {
      const result = await syncAvitoProducts(
        prisma,
        { clientId: "client", clientSecret: "secret" },
        { fetchFn, sleepFn: async () => undefined },
      );

      expect(result.imagesFound).toBe(1);
      expect(fetchFn).toHaveBeenCalledTimes(3);
      expect(upsert).toHaveBeenCalledWith(expect.objectContaining({
        create: expect.objectContaining({
          avitoItemId: "7",
          imageUrl: "http://crm.test/photo.jpeg",
        }),
      }));
    } finally {
      if (previousRoot === undefined) delete process.env.BOTV_WEB_SESSIONS_DIR;
      else process.env.BOTV_WEB_SESSIONS_DIR = previousRoot;
      __resetBotvImageCacheForTests();
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("fills missing images from BotV XML by Avito autoload_item_id", async () => {
    const previousRoot = process.env.BOTV_WEB_SESSIONS_DIR;
    const previousLimit = process.env.AVITO_SYNC_IMAGE_DETAIL_LIMIT;
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "crmavito-botv-"));
    const sessionDir = path.join(tempRoot, "session");
    await mkdir(sessionDir, { recursive: true });
    await writeFile(
      path.join(sessionDir, "avito.xml"),
      `<?xml version="1.0" encoding="UTF-8"?><Ads><Ad><Id>SKU-7</Id><Title>Changed title</Title><Images><Image url="https://crm.test/sku-7.jpg"/></Images></Ad></Ads>`,
      "utf8",
    );
    process.env.BOTV_WEB_SESSIONS_DIR = tempRoot;
    process.env.AVITO_SYNC_IMAGE_DETAIL_LIMIT = "1";
    __resetBotvImageCacheForTests();
    __resetAvitoTokenCacheForTests();

    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ access_token: "token" }))
      .mockResolvedValueOnce(Response.json({ resources: [{ id: 7, title: "Avito title", price: 100 }] }))
      .mockResolvedValueOnce(Response.json({ resources: [] }))
      .mockResolvedValueOnce(new Response("not found", { status: 404 }))
      .mockResolvedValueOnce(new Response("not found", { status: 404 }))
      .mockResolvedValueOnce(Response.json({ id: 123 }))
      .mockResolvedValueOnce(Response.json({ autoload_item_id: "SKU-7", status: "active" })) as unknown as typeof fetch;
    const upsert = vi.fn(async () => ({}));
    const prisma = {
      product: {
        findMany: vi.fn(async () => []),
        upsert,
        updateMany: vi.fn(async () => ({ count: 0 })),
      },
    } as unknown as Parameters<typeof syncAvitoProducts>[0];

    try {
      const result = await syncAvitoProducts(
        prisma,
        { clientId: "client", clientSecret: "secret" },
        { fetchFn, sleepFn: async () => undefined },
      );

      expect(result.imagesFound).toBe(1);
      expect(upsert).toHaveBeenCalledWith(expect.objectContaining({
        create: expect.objectContaining({
          avitoItemId: "7",
          imageUrl: "https://crm.test/sku-7.jpg",
        }),
      }));
    } finally {
      if (previousRoot === undefined) delete process.env.BOTV_WEB_SESSIONS_DIR;
      else process.env.BOTV_WEB_SESSIONS_DIR = previousRoot;
      if (previousLimit === undefined) delete process.env.AVITO_SYNC_IMAGE_DETAIL_LIMIT;
      else process.env.AVITO_SYNC_IMAGE_DETAIL_LIMIT = previousLimit;
      __resetBotvImageCacheForTests();
      __resetAvitoTokenCacheForTests();
      await rm(tempRoot, { recursive: true, force: true });
    }
  });
});
