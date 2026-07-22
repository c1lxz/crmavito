import { describe, expect, it, vi } from "vitest";
import { brotliCompressSync } from "node:zlib";
import { buildAdsAnalysisPrompt, type AdsAnalysisInput } from "@/lib/ai/ads-analysis";
import { createClaudeAdsReport } from "@/lib/ai/claude";
import { buildProductPhotoPrompt, generateGeminiImage } from "@/lib/ai/gemini-images";

const analytics: AdsAnalysisInput = {
  profileId: "profile-1",
  accountId: "42",
  periodDays: 7,
  dateFrom: "2026-07-16",
  dateTo: "2026-07-22",
  total: { ads: 1, views: 100, contacts: 2, favorites: 15 },
  items: [{
    itemId: "101",
    title: "Футболка оверсайз",
    url: "https://www.avito.ru/item_101",
    status: "active",
    views: 100,
    contacts: 2,
    favorites: 15,
    price: 2500,
    description: null,
    imageCount: 4,
  }],
};

describe("AI providers", () => {
  it("adds conversion signals to the Claude prompt", () => {
    const prompt = buildAdsAnalysisPrompt(analytics);
    expect(prompt).toContain('"contactRate":2');
    expect(prompt).toContain('"favoriteRate":15');
    expect(prompt).toContain("Не выдумывай отсутствующие");
  });

  it("calls the Anthropic messages API and validates the report", async () => {
    const fetchFn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      expect(String(url)).toBe("https://claude.example/v1/messages");
      expect(new Headers(init?.headers).get("x-api-key")).toBe("secret");
      return Response.json({
        content: [{
          type: "text",
          text: JSON.stringify({
            executiveSummary: "Есть спрос, но мало контактов.",
            healthScore: 64,
            opportunity: "Усилить оффер.",
            actions: [{
              id: "offer-101",
              itemId: "101",
              title: "Футболка оверсайз",
              priority: "high",
              field: "description",
              diagnosis: "15% добавляют в избранное, но только 2% связываются.",
              proposedValue: null,
              expectedImpact: "Рост обращений.",
              applyMode: "manual",
            }],
          }),
        }],
      });
    }) as unknown as typeof fetch;

    const report = await createClaudeAdsReport(analytics, {
      fetchFn,
      apiKey: "secret",
      baseUrl: "https://claude.example/",
      model: "claude-test",
    });
    expect(report.healthScore).toBe(64);
    expect(report.actions[0].itemId).toBe("101");
  });

  it("uses Gemini only as an image provider", async () => {
    const fetchFn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      expect(String(url)).toContain("/v1beta/interactions");
      const body = JSON.parse(String(init?.body));
      expect(body.model).toBe("gemini-3.1-flash-image");
      expect(body.response_format.type).toBe("image");
      expect(body.response_format.mime_type).toBe("image/jpeg");
      expect(body.input).toEqual([
        { type: "image", data: "cHJvZHVjdA==", mime_type: "image/jpeg" },
        { type: "image", data: "YmFja2dyb3VuZA==", mime_type: "image/png" },
        expect.objectContaining({ type: "text" }),
      ]);
      return Response.json({ output_image: { data: "aW1hZ2U=", mime_type: "image/jpeg" } });
    }) as unknown as typeof fetch;

    const image = await generateGeminiImage(
      {
        prompt: buildProductPhotoPrompt(),
        referenceImages: [
          { data: "cHJvZHVjdA==", mimeType: "image/jpeg" },
          { data: "YmFja2dyb3VuZA==", mimeType: "image/png" },
        ],
      },
      { fetchFn, apiKey: "gemini-secret" },
    );
    expect(image).toMatchObject({ data: "aW1hZ2U=", mimeType: "image/jpeg" });
  });

  it("locks garment identity and background in the product photo prompt", () => {
    const prompt = buildProductPhotoPrompt();
    expect(prompt).toContain("immutable product identity");
    expect(prompt).toContain("every letter, font, spacing");
    expect(prompt).toContain("may improve the garment's placement");
    expect(prompt).toContain("same visible side");
    expect(prompt).toContain("ONLY ALLOWED BACKGROUND");
    expect(prompt).toContain("No props, hands, people");
    expect(prompt).toContain("Create exactly ONE");
  });

  it("keeps a plain-text Claude gateway error in the user-facing message", async () => {
    const fetchFn = vi.fn(async () => new Response("error code: 1101", { status: 500 })) as unknown as typeof fetch;
    await expect(createClaudeAdsReport(analytics, {
      fetchFn,
      apiKey: "secret",
      baseUrl: "https://claude.example",
      maxAttempts: 1,
    })).rejects.toThrow("error code: 1101");
  });

  it("retries a successful HTTP response containing a gateway capacity error", async () => {
    const fetchFn = vi.fn()
      .mockResolvedValueOnce(new Response("Failed to start container: Maximum number of running container instances exceeded", { status: 200 }))
      .mockResolvedValueOnce(Response.json({
        content: [{
          type: "text",
          text: JSON.stringify({
            executiveSummary: "Повторный запрос выполнен.",
            healthScore: 70,
            opportunity: "Улучшить карточки.",
            actions: [],
          }),
        }],
      }));

    const report = await createClaudeAdsReport(analytics, {
      fetchFn: fetchFn as unknown as typeof fetch,
      apiKey: "secret",
      baseUrl: "https://claude.example",
    });
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(report.healthScore).toBe(70);
  });

  it("decodes an unlabelled Brotli response returned by the Claude gateway", async () => {
    const payload = JSON.stringify({
      content: [{
        type: "text",
        text: JSON.stringify({
          executiveSummary: "Сжатый отчёт прочитан.",
          healthScore: 81,
          opportunity: "Улучшить конверсию.",
          actions: [],
        }),
      }],
    });
    const compressed = brotliCompressSync(Buffer.from(payload));
    const fetchFn = vi.fn(async () => new Response(new Uint8Array(compressed), {
      status: 200,
      headers: { "content-type": "application/json" },
    })) as unknown as typeof fetch;

    const report = await createClaudeAdsReport(analytics, {
      fetchFn,
      apiKey: "secret",
      baseUrl: "https://claude.example",
    });
    expect(report.healthScore).toBe(81);
  });
});
