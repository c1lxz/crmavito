import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  fetchWbOrderStickerBarcode: vi.fn(),
}));

const imageMocks = vi.hoisted(() => ({
  downloadImageAsBuffer: vi.fn(),
}));

vi.mock("@/lib/avito/fetch-image", () => ({
  downloadImageAsBuffer: imageMocks.downloadImageAsBuffer,
}));
vi.mock("@/lib/wb/stickers", () => ({
  fetchWbOrderStickerBarcode: mocks.fetchWbOrderStickerBarcode,
}));

import { sendNoteMentionNotification, sendOrderToGroup } from "@/lib/telegram/notify";

describe("Telegram transport failures", () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    delete process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.TELEGRAM_GROUP_CHAT_ID;
    delete process.env.NEXTAUTH_URL;
  });

  it("rejects a failed Telegram response so the durable queue can retry it", async () => {
    process.env.TELEGRAM_BOT_TOKEN = "token";
    process.env.TELEGRAM_GROUP_CHAT_ID = "chat";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        json: async () => ({ ok: false, description: "temporary error" }),
      })
    );

    await expect(
      sendOrderToGroup({
        orderNumber: "0001",
        marketplace: "AVITO",
        items: [
          {
            productName: "Товар",
            variant: null,
            size: null,
            quantity: 1,
            salePrice: 2500,
            imageUrls: [],
          },
        ],
        trackingNumber: "TRACK-1",
        carrier: "СДЭК",
        counterpartyName: "Поставщик",
        orderDate: new Date("2026-07-01"),
      })
    ).rejects.toThrow("temporary error");
  });

  it("rejects when Telegram credentials are unavailable", async () => {
    await expect(
      sendOrderToGroup({
        orderNumber: "0001",
        marketplace: "AVITO",
        items: [],
        trackingNumber: "TRACK-1",
        carrier: "",
        counterpartyName: "",
        orderDate: new Date(),
      })
    ).rejects.toThrow("TELEGRAM_BOT_TOKEN");
  });

  it("sends an official WB sticker QR to the same order group", async () => {
    process.env.TELEGRAM_BOT_TOKEN = "token";
    process.env.TELEGRAM_GROUP_CHAT_ID = "chat";
    mocks.fetchWbOrderStickerBarcode.mockResolvedValue(
      "60427936_39440_297122_1",
    );
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await sendOrderToGroup({
      orderNumber: "0002",
      marketplace: "WB",
      items: [],
      trackingNumber: "2080788852754132992",
      carrier: "",
      counterpartyName: "WB",
      orderDate: new Date("2026-07-27"),
    });

    expect(mocks.fetchWbOrderStickerBarcode).toHaveBeenCalledWith(
      "2080788852754132992",
    );
    expect(fetchMock.mock.calls[0][0]).toContain("/sendPhoto");
    const form = fetchMock.mock.calls[0][1].body as FormData;
    expect((form.get("photo") as File).name).toBe("wb-qr.png");
    expect(form.get("chat_id")).toBe("chat");
  });

  it("still sends an order when a product image cannot be downloaded", async () => {
    process.env.TELEGRAM_BOT_TOKEN = "token";
    process.env.TELEGRAM_GROUP_CHAT_ID = "chat";
    imageMocks.downloadImageAsBuffer.mockResolvedValue(null);
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await sendOrderToGroup({
      orderNumber: "0003",
      marketplace: "AVITO",
      items: [{
        productName: "Товар",
        variant: null,
        size: null,
        quantity: 1,
        salePrice: 2500,
        imageUrls: ["https://images.example/unavailable.jpg"],
      }],
      trackingNumber: "TRACK-3",
      carrier: "",
      counterpartyName: "",
      orderDate: new Date("2026-08-13"),
    });

    expect(imageMocks.downloadImageAsBuffer).toHaveBeenCalledTimes(3);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toContain("/sendPhoto");
    const form = fetchMock.mock.calls[0][1].body as FormData;
    expect((form.get("photo") as File).name).toBe("barcode.png");
  });

  it("falls back to a regular barcode when the WB sticker API is unavailable", async () => {
    process.env.TELEGRAM_BOT_TOKEN = "token";
    process.env.TELEGRAM_GROUP_CHAT_ID = "chat";
    mocks.fetchWbOrderStickerBarcode.mockRejectedValue(new Error("WB API timeout"));
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await sendOrderToGroup({
      orderNumber: "0004",
      marketplace: "WB",
      items: [],
      trackingNumber: "2080788852754132992",
      carrier: "",
      counterpartyName: "WB",
      orderDate: new Date("2026-08-13"),
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const form = fetchMock.mock.calls[0][1].body as FormData;
    expect((form.get("photo") as File).name).toBe("barcode.png");
  });

  it("sends a note mention with a direct notebook button", async () => {
    process.env.TELEGRAM_BOT_TOKEN = "token";
    process.env.NEXTAUTH_URL = "https://crmavito.example";
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, result: { message_id: 1 } }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await sendNoteMentionNotification({
      recipientTelegramId: "123",
      noteTitle: "Проверить поставку",
      authorName: "Иван",
    });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.chat_id).toBe("123");
    expect(body.text).toContain("Вас отметили в заметке");
    expect(body.text).toContain("Ознакомьтесь");
    expect(body.reply_markup.inline_keyboard[0][0]).toEqual({
      text: "Открыть блокнот",
      url: "https://crmavito.example/m/tasks",
    });
  });
});
