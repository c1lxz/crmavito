import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchAvitoAutoloadStatus, publishAvitoXml } from "@/lib/avito/publish";

const credentials = { clientId: "client", clientSecret: "secret" };

describe("Avito XML publication", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("requires a public feed url for Avito autoload", async () => {
    await expect(
      publishAvitoXml(credentials, "<Ads />", "avito.xml", {
        feedUrl: "",
        fetchFn: vi.fn() as unknown as typeof fetch,
        sleepFn: async () => undefined,
      }),
    ).rejects.toThrow("публичный URL XML-фида");
  });

  it("configures the autoload feed and starts upload by link", async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const fetchFn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      const href = String(url);
      if (href.includes("/token")) {
        return Response.json({ access_token: "token", expires_in: 3600, token_type: "Bearer" });
      }
      if (href.includes("/autoload/v2/profile") && init?.method !== "POST") {
        return Response.json({
          autoload_enabled: true,
          feeds_data: [],
          report_email: "reports@example.test",
          schedule: [],
        });
      }
      if (href.includes("/autoload/v2/profile") && init?.method === "POST") {
        return new Response("", { status: 200 });
      }
      if (href.includes("/autoload/v1/upload")) {
        return new Response("", { status: 200 });
      }
      return new Response("unexpected", { status: 500 });
    }) as unknown as typeof fetch;

    const result = await publishAvitoXml(credentials, "<Ads />", "avito.xml", {
      feedUrl: "https://crmavito.duckdns.org/v-data/botv/work/session-1/xml",
      fetchFn,
      sleepFn: async () => undefined,
    });

    expect(result.uploadStatus).toBe(200);
    expect(result.feedUrl).toContain("/v-data/botv/work/session-1/xml");

    const profileCall = calls.find((call) => call.url.includes("/autoload/v2/profile") && call.init?.method === "POST");
    expect(profileCall?.init?.headers).toEqual({
      Authorization: "Bearer token",
      "Content-Type": "application/json",
    });
    expect(JSON.parse(String(profileCall?.init?.body))).toEqual({
      agreement: true,
      autoload_enabled: true,
      feeds_data: [
        {
          feed_name: "avito.xml",
          feed_url: "https://crmavito.duckdns.org/v-data/botv/work/session-1/xml",
        },
      ],
      report_email: "reports@example.test",
      schedule: [],
    });

    const uploadCall = calls.find((call) => call.url.includes("/autoload/v1/upload"));
    expect(uploadCall?.init?.method).toBe("POST");
    expect(uploadCall?.init?.headers).toEqual({ Authorization: "Bearer token" });
  });

  it("continues when Avito does not allow reading the autoload profile", async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const fetchFn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      const href = String(url);
      if (href.includes("/token")) {
        return Response.json({ access_token: "token", expires_in: 3600, token_type: "Bearer" });
      }
      if (href.includes("/autoload/v2/profile") && init?.method !== "POST") {
        return Response.json({ error: { message: "Получение профиля недоступно." } }, { status: 403 });
      }
      if (href.includes("/autoload/v2/profile") && init?.method === "POST") {
        return new Response("", { status: 200 });
      }
      if (href.includes("/autoload/v1/upload")) {
        return new Response("", { status: 200 });
      }
      return new Response("unexpected", { status: 500 });
    }) as unknown as typeof fetch;

    await expect(
      publishAvitoXml(credentials, "<Ads />", "avito.xml", {
        feedUrl: "https://crmavito.duckdns.org/v-data/botv/work/session-1/xml",
        reportEmail: "reports@example.test",
        fetchFn,
        sleepFn: async () => undefined,
      }),
    ).resolves.toMatchObject({ uploadStatus: 200 });

    const profileCall = calls.find((call) => call.url.includes("/autoload/v2/profile") && call.init?.method === "POST");
    expect(JSON.parse(String(profileCall?.init?.body)).report_email).toBe("reports@example.test");
  });

  it("loads current and recent autoload uploads", async () => {
    const fetchFn = vi.fn(async (url: string | URL | Request) => {
      const href = String(url);
      if (href.includes("/token")) {
        return Response.json({ access_token: "token", expires_in: 3600, token_type: "Bearer" });
      }
      if (href.includes("/autoload/v4/uploads/current")) {
        return Response.json({ upload_id: 1, status: "processing" });
      }
      if (href.includes("/autoload/v4/uploads/last_successful")) {
        return Response.json({ upload_id: 0, status: "success" });
      }
      if (href.includes("/autoload/v4/uploads?")) {
        return Response.json({ uploads: [{ upload_id: 1 }, { upload_id: 0 }] });
      }
      return new Response("unexpected", { status: 500 });
    }) as unknown as typeof fetch;

    await expect(
      fetchAvitoAutoloadStatus(credentials, {
        fetchFn,
        sleepFn: async () => undefined,
      }),
    ).resolves.toEqual({
      current: { upload_id: 1, status: "processing" },
      lastSuccessful: { upload_id: 0, status: "success" },
      uploads: [{ upload_id: 1 }, { upload_id: 0 }],
    });
  });
});
