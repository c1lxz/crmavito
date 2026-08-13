import { describe, expect, it } from "vitest";
import {
  preserveTelegramInitData,
  readTelegramInitData,
} from "@/lib/telegram/client-init-data";

function storage(initial?: string) {
  let value = initial ?? null;
  return {
    getItem: () => value,
    setItem: (_key: string, next: string) => {
      value = next;
    },
  };
}

describe("Telegram Mini App init data", () => {
  it("uses the Telegram SDK value when it is available", () => {
    expect(
      readTelegramInitData({ Telegram: { WebApp: { initData: "signed-sdk-data" } } }),
    ).toBe("signed-sdk-data");
  });

  it("recovers init data from the Telegram launch hash without the SDK", () => {
    expect(
      readTelegramInitData({
        location: {
          hash: "#tgWebAppData=query_id%3Dabc%26user%3Demployee&tgWebAppVersion=9.1",
        },
      }),
    ).toBe("query_id=abc&user=employee");
  });

  it("preserves init data while the app navigates through protected routes", () => {
    const sessionStorage = storage();
    preserveTelegramInitData({
      location: { search: "?tgWebAppData=signed%253Ddata" },
      sessionStorage,
    });

    expect(readTelegramInitData({ sessionStorage })).toBe("signed%3Ddata");
  });
});
