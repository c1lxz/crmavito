import { describe, expect, it } from "vitest";
import { buildOrderCaption } from "@/lib/telegram/notify";

describe("Telegram order notification", () => {
  it("formats the caption like the bot card and uppercases the size", () => {
    expect(
      buildOrderCaption({
        trackingNumber: "10283054533",
        carrier: "СДЭК",
        size: "xxs",
      })
    ).toBe("10283054533\nСДЭК\nXXS");
  });

  it("omits empty optional lines", () => {
    expect(
      buildOrderCaption({
        trackingNumber: "10283054533",
        carrier: "",
        size: null,
      })
    ).toBe("10283054533");
  });

  it("prints sizes of all order items in their original order", () => {
    expect(
      buildOrderCaption({
        trackingNumber: "10283054533",
        carrier: "СДЭК",
        sizes: ["m", "xl"],
      }),
    ).toBe("10283054533\nСДЭК\nM\nXL");
  });
});
