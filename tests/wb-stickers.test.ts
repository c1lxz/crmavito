import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchWbOrderStickerBarcode } from "@/lib/wb/stickers";

describe("WB order stickers", () => {
  afterEach(() => {
    delete process.env.WB_MARKETPLACE_API_TOKEN;
    delete process.env.WB_API_TOKEN;
  });

  it("requests the official sticker without losing int64 order ID precision", async () => {
    const fetchFn = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        stickers: [
          {
            orderId: 2080788852754132992,
            barcode: "60427936_39440_297122_1",
            file: "base64",
          },
        ],
      }),
    });

    await expect(
      fetchWbOrderStickerBarcode("2080788852754132992", {
        token: "wb-token",
        fetchFn,
      }),
    ).resolves.toBe("60427936_39440_297122_1");

    expect(fetchFn).toHaveBeenCalledWith(
      "https://marketplace-api.wildberries.ru/api/v3/orders/stickers?type=png&width=40&height=30",
      expect.objectContaining({
        method: "POST",
        headers: {
          Authorization: "wb-token",
          "Content-Type": "application/json",
        },
        body: '{"orders":[2080788852754132992]}',
      }),
    );
  });

  it("rejects a regular tracking string because it cannot produce a valid WB QR", async () => {
    await expect(
      fetchWbOrderStickerBarcode("TRACK-1", { token: "wb-token" }),
    ).rejects.toThrow("числовой ID");
  });

  it("reports missing WB API configuration clearly", async () => {
    await expect(
      fetchWbOrderStickerBarcode("2080214251233882112"),
    ).rejects.toThrow("WB_MARKETPLACE_API_TOKEN");
  });
});
