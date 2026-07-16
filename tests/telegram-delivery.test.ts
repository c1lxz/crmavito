import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/avito/fetch-image", () => ({
  downloadImageAsBuffer: vi.fn(),
}));

import { sendOrderToGroup } from "@/lib/telegram/notify";

describe("Telegram transport failures", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.TELEGRAM_GROUP_CHAT_ID;
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
        items: [],
        trackingNumber: "TRACK-1",
        carrier: "",
        counterpartyName: "",
        orderDate: new Date(),
      })
    ).rejects.toThrow("TELEGRAM_BOT_TOKEN");
  });
});
