import { afterEach, describe, expect, it, vi } from "vitest";
import { publishAvitoXml } from "@/lib/avito/publish";

const credentials = { clientId: "client", clientSecret: "secret" };

describe("Avito XML publication", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("requires an explicit publication endpoint", async () => {
    vi.stubEnv("AVITO_XML_PUBLISH_URL", "");

    await expect(
      publishAvitoXml(credentials, "<Ads />", "avito.xml", {
        fetchFn: vi.fn() as unknown as typeof fetch,
        sleepFn: async () => undefined,
      }),
    ).rejects.toThrow("AVITO_XML_PUBLISH_URL");
  });

  it("posts generated XML as multipart form data", async () => {
    vi.stubEnv("AVITO_XML_PUBLISH_URL", "https://api.avito.ru/custom-publish");
    const calls: { url: string; init?: RequestInit }[] = [];
    const fetchFn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      if (String(url).includes("/token")) {
        return Response.json({ access_token: "token", expires_in: 3600, token_type: "Bearer" });
      }
      if (String(url).includes("/custom-publish")) {
        return Response.json({ ok: true }, { status: 201 });
      }
      return new Response("unexpected", { status: 500 });
    }) as unknown as typeof fetch;

    const result = await publishAvitoXml(credentials, "<Ads />", "avito.xml", {
      fetchFn,
      sleepFn: async () => undefined,
    });

    expect(result.status).toBe(201);
    const publishCall = calls.find((call) => call.url.includes("/custom-publish"));
    expect(publishCall?.init?.method).toBe("POST");
    expect(publishCall?.init?.headers).toEqual({ Authorization: "Bearer token" });
    expect(publishCall?.init?.body).toBeInstanceOf(FormData);
  });
});
