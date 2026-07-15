import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const apiSource = readFileSync(
  path.resolve(__dirname, "../lib/avito/api.ts"),
  "utf8"
);
const fetcherSource = readFileSync(
  path.resolve(__dirname, "../lib/avito/fetch-image.ts"),
  "utf8"
);
const ordersRouteSource = readFileSync(
  path.resolve(__dirname, "../app/api/orders/route.ts"),
  "utf8"
);
const packageSource = readFileSync(
  path.resolve(__dirname, "../package.json"),
  "utf8"
);
const deploySource = readFileSync(path.resolve(__dirname, "../deploy.sh"), "utf8");

describe("Avito API fetcher (smoke)", () => {
  it("caches OAuth token", () => {
    expect(apiSource).toContain("tokenCache");
    expect(apiSource).toContain("expiresAt");
  });

  it("tries both /core/v1/items and accounts/{id}/items endpoints", () => {
    expect(apiSource).toContain("/core/v1/items/");
    expect(apiSource).toContain("/core/v1/accounts/");
    expect(apiSource).toContain("tryEndpoint");
  });

  it("recursively finds image URLs in JSON responses", () => {
    expect(apiSource).toContain("findFirstImageUrl");
    expect(apiSource).toMatch(/jpg|jpeg|png|webp/);
  });

  it("logs failures to console", () => {
    expect(apiSource).toContain("console.error");
    expect(apiSource).toContain("[avito]");
  });
});

describe("resolveProductImage (smoke)", () => {
  it("tries API first, then HTML scrape", () => {
    expect(fetcherSource).toContain("fetchAvitoItemImage");
    expect(fetcherSource).toContain("scrapeListingHtml");
    const apiIdx = fetcherSource.indexOf("fetchAvitoItemImage");
    const htmlIdx = fetcherSource.indexOf("scrapeListingHtml(p.avitoListingUrl)");
    expect(apiIdx).toBeGreaterThan(-1);
    expect(htmlIdx).toBeGreaterThan(apiIdx);
  });

  it("exports downloadImageAsBuffer for reuse", () => {
    expect(fetcherSource).toContain("export async function downloadImageAsBuffer");
    expect(fetcherSource).toContain("Buffer.from(ab)");
  });
});

describe("Telegram group notifications are disabled", () => {
  it("does not create or send order notifications to a Telegram group", () => {
    expect(ordersRouteSource).not.toContain("notification: { create: {} }");
    expect(ordersRouteSource).not.toContain("processOrderNotificationByOrderId");
    expect(existsSync(path.resolve(__dirname, "../lib/telegram/notify.ts"))).toBe(
      false
    );
    expect(
      existsSync(
        path.resolve(__dirname, "../lib/telegram/order-notification-queue.ts")
      )
    ).toBe(false);
    expect(
      existsSync(path.resolve(__dirname, "../scripts/telegram-notify-worker.js"))
    ).toBe(false);
    expect(
      existsSync(
        path.resolve(
          __dirname,
          "../app/api/internal/telegram-notifications/route.ts"
        )
      )
    ).toBe(false);
    expect(packageSource).not.toContain("telegram:notify-worker");
    expect(deploySource).not.toContain("telegram-notify");
  });
});
