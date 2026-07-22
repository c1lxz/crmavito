import { describe, expect, it } from "vitest";
import { inspectAvitoXml } from "@/lib/botv/custom-xml-feed";

describe("custom Avito XML feeds", () => {
  it("accepts a valid feed and reports its IDs", () => {
    const result = inspectAvitoXml(`<?xml version="1.0" encoding="UTF-8"?>
      <Ads formatVersion="3" target="Avito.ru">
        <Ad><Id>SKU-one</Id></Ad>
        <Ad><Id>SKU-two</Id></Ad>
      </Ads>`);

    expect(result.ads).toBe(2);
    expect(result.adIds).toEqual(["SKU-one", "SKU-two"]);
  });

  it("rejects duplicate IDs", () => {
    expect(() => inspectAvitoXml(`<?xml version="1.0"?><Ads><Ad><Id>SKU-1</Id></Ad><Ad><Id>SKU-1</Id></Ad></Ads>`))
      .toThrow("повторяющиеся Id");
  });

  it("rejects incomplete feeds", () => {
    expect(() => inspectAvitoXml(`<?xml version="1.0"?><Ads><Ad><Id>SKU-1</Id></Ads>`))
      .toThrow("повреждён");
  });
});
