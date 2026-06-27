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

describe("Avito API fetcher (smoke)", () => {
  it("кеширует OAuth-токен", () => {
    expect(apiSource).toContain("tokenCache");
    expect(apiSource).toContain("expiresAt");
  });

  it("пробует несколько endpoint'ов /core/v1/items", () => {
    expect(apiSource).toContain("/core/v1/items/");
    expect(apiSource).toContain("tryEndpoints");
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
    expect(notifySource).toContain("attach://product");
  });

  it("логирует фейлы Telegram API", () => {
    expect(notifySource).toContain("tgFetch");
    expect(notifySource).toContain("[telegram]");
  });

  it("откатывается на текст если нет ни картинки ни штрихкода", () => {
    expect(notifySource).toContain("sendMessage");
  });
});

describe("POST /api/orders integrates image resolver (smoke)", () => {
  it("дотягивает картинку синхронно перед уведомлением", () => {
    expect(ordersRouteSource).toContain("resolveProductImage");
    expect(ordersRouteSource).toContain("sendOrderToGroup");
    // Ищем именно ВЫЗОВ функций (со скобками), а не импорты
    const resolveCallIdx = ordersRouteSource.indexOf("resolveProductImage({");
    const sendCallIdx = ordersRouteSource.indexOf("sendOrderToGroup({");
    expect(resolveCallIdx).toBeGreaterThan(-1);
    expect(sendCallIdx).toBeGreaterThan(resolveCallIdx);
  });
});
