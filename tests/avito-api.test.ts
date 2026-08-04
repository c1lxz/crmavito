import { readFileSync } from "node:fs";
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
const notifySource = readFileSync(
  path.resolve(__dirname, "../lib/telegram/notify.ts"),
  "utf8"
);
const ordersRouteSource = readFileSync(
  path.resolve(__dirname, "../app/api/orders/route.ts"),
  "utf8"
);
const queueSource = readFileSync(
  path.resolve(__dirname, "../lib/telegram/order-notification-queue.ts"),
  "utf8"
);
const workerSource = readFileSync(
  path.resolve(__dirname, "../scripts/telegram-notify-worker.js"),
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
  it("tries HTML scrape before API fallback", () => {
    expect(fetcherSource).toContain("fetchAvitoListingImage");
    expect(fetcherSource).toContain("fetchAvitoItemImage");
    expect(fetcherSource).toContain("fetchAvitoItemImageWithToken");
    const htmlIdx = fetcherSource.indexOf("fetchAvitoListingImage(p.avitoListingUrl)");
    const apiIdx = fetcherSource.indexOf("fetchAvitoItemImage(p.avitoItemId)");
    const tokenApiIdx = fetcherSource.indexOf("fetchAvitoItemImageWithToken(p.avitoItemId");
    expect(apiIdx).toBeGreaterThan(-1);
    expect(tokenApiIdx).toBeGreaterThan(-1);
    expect(htmlIdx).toBeGreaterThan(-1);
    expect(apiIdx).toBeGreaterThan(htmlIdx);
    expect(tokenApiIdx).toBeGreaterThan(htmlIdx);
  });

  it("exports downloadImageAsBuffer for reuse", () => {
    expect(fetcherSource).toContain("export async function downloadImageAsBuffer");
    expect(fetcherSource).toContain("Buffer.from(arrayBuffer)");
  });
});

describe("Telegram group notifications", () => {
  it("creates a durable order notification and attempts immediate delivery", () => {
    expect(ordersRouteSource).toContain("notification: { create: {} }");
    expect(ordersRouteSource).toContain("processOrderNotificationByOrderId(order.id)");
  });

  it("sends order photos and barcode to the configured Telegram group", () => {
    expect(notifySource).toContain("TELEGRAM_GROUP_CHAT_ID");
    expect(notifySource).toContain("sendOrderToGroup");
    expect(notifySource).toContain("sendMediaGroup");
    expect(notifySource).toContain("generateBarcodePng");
    expect(notifySource).toContain("fetchWbOrderStickerBarcode");
    expect(notifySource).toContain("generateQrCodePng");
    expect(queueSource).toContain("marketplace: order.marketplace");
  });

  it("retries failed notifications through the production worker", () => {
    expect(queueSource).toContain('status: "RETRY"');
    expect(queueSource).toContain("processPendingOrderNotifications");
    expect(workerSource).toContain("/api/internal/telegram-notifications");
    expect(packageSource).toContain("telegram:notify-worker");
    expect(deploySource).toContain("telegram-notify");
  });
});
