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

describe("Avito API fetcher (smoke)", () => {
  it("кеширует OAuth-токен", () => {
    expect(apiSource).toContain("tokenCache");
    expect(apiSource).toContain("expiresAt");
  });

  it("пробует несколько endpoint'ов /core/v1/items + accounts/{id}/items", () => {
    expect(apiSource).toContain("/core/v1/items/");
    expect(apiSource).toContain("/core/v1/accounts/");
    expect(apiSource).toContain("tryEndpoint");
  });

  it("рекурсивно ищет URL картинок в JSON-ответе", () => {
    expect(apiSource).toContain("findFirstImageUrl");
    expect(apiSource).toMatch(/jpg|jpeg|png|webp/);
  });

  it("логирует фейлы в консоль", () => {
    expect(apiSource).toContain("console.error");
    expect(apiSource).toContain("[avito]");
  });
});

describe("resolveProductImage (smoke)", () => {
  it("сначала пробует API, потом HTML-скрейп", () => {
    expect(fetcherSource).toContain("fetchAvitoItemImage");
    expect(fetcherSource).toContain("scrapeListingHtml");
    const apiIdx = fetcherSource.indexOf("fetchAvitoItemImage");
    const htmlIdx = fetcherSource.indexOf("scrapeListingHtml(p.avitoListingUrl)");
    expect(apiIdx).toBeGreaterThan(-1);
    expect(htmlIdx).toBeGreaterThan(apiIdx);
  });

  it("экспортирует downloadImageAsBuffer для Telegram", () => {
    expect(fetcherSource).toContain("export async function downloadImageAsBuffer");
    expect(fetcherSource).toContain("Buffer.from(ab)");
  });
});

describe("Telegram notify (smoke)", () => {
  it("качает картинку перед отправкой и шлёт мультипартом", () => {
    expect(notifySource).toContain("downloadImageAsBuffer");
    expect(notifySource).toContain("attach://image");
    expect(notifySource).toContain("flatMap");
    expect(notifySource).toContain("batchIndex");
    expect(notifySource).not.toContain("slice(0, 9)");
  });

  it("логирует фейлы Telegram API", () => {
    expect(notifySource).toContain("tgFetch");
    expect(notifySource).toContain("[telegram]");
  });

  it("не проглатывает ошибку Telegram", () => {
    expect(notifySource).not.toContain("sendOrderToGroup failed");
    expect(notifySource).toContain("throw new Error");
  });
});

describe("POST /api/orders uses a durable Telegram queue (smoke)", () => {
  it("creates the queue record atomically and attempts immediate delivery", () => {
    expect(ordersRouteSource).toContain("notification: { create: {} }");
    expect(ordersRouteSource).toContain("processOrderNotificationByOrderId(order.id)");
  });

  it("retries failures and resumes multipart delivery from the last sent batch", () => {
    expect(queueSource).toContain('status: "RETRY"');
    expect(queueSource).toContain("nextAttemptAt");
    expect(queueSource).toContain("sentBatches");
    expect(queueSource).toContain("processPendingOrderNotifications");
  });

  it("runs the production worker with plain Node.js and no platform-specific TS runtime", () => {
    expect(workerSource).toContain("/api/internal/telegram-notifications");
    expect(workerSource).not.toContain("tsx");
    expect(workerSource).not.toContain("esbuild");
  });
});
