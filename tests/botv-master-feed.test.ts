import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  masterFeedKey,
  mergeAvitoMasterXml,
  reconcileAvitoMasterXml,
  readMasterXmlFeed,
  rollbackMasterXmlFeed,
  saveMasterXmlFeed,
} from "@/lib/botv/master-xml-feed";

function xml(ads: Array<{ id: string; title: string }>) {
  return `<?xml version="1.0" encoding="UTF-8"?><Ads formatVersion="3" target="Avito.ru">${ads
    .map((ad) => `<Ad><Id>${ad.id}</Id><Title>${ad.title}</Title></Ad>`)
    .join("")}</Ads>`;
}

function fullXml(ads: Array<{ id: string; title: string; address: string; image?: string }>) {
  return `<?xml version="1.0" encoding="UTF-8"?><Ads formatVersion="3" target="Avito.ru">${ads
    .map((ad) => `<Ad><Id>${ad.id}</Id><Title>${ad.title}</Title><Address>${ad.address}</Address><Images><Image url="https://example.test/${ad.image ?? `${ad.id}.jpg`}" /></Images></Ad>`)
    .join("")}</Ads>`;
}

describe("safe Avito master XML", () => {
  it("preserves old ads, appends new ads and updates matching IDs", () => {
    const result = mergeAvitoMasterXml(
      xml([{ id: "old-1", title: "Old one" }, { id: "same-2", title: "Old title" }]),
      xml([{ id: "same-2", title: "New title" }, { id: "new-3", title: "New three" }]),
    );

    expect(result.adIds).toEqual(["old-1", "same-2", "new-3"]);
    expect(result.previousAds).toBe(2);
    expect(result.addedAds).toBe(1);
    expect(result.updatedAds).toBe(1);
    expect(result.removedAds).toBe(0);
    expect(result.xml).toContain("Old one");
    expect(result.xml).toContain("New title");
    expect(result.xml).not.toContain("Old title");
  });

  it("uses a stable opaque key without exposing the profile id", () => {
    const first = masterFeedKey("profile-quietpanic");
    expect(first).toBe(masterFeedKey("profile-quietpanic"));
    expect(first).toMatch(/^[0-9a-f]{24}$/);
    expect(first).not.toContain("quietpanic");
  });

  it("atomically restores the previous feed when publication fails", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "crmavito-master-feed-"));
    const previousDirectory = process.env.BOTV_MASTER_FEEDS_DIR;
    process.env.BOTV_MASTER_FEEDS_DIR = directory;
    const key = masterFeedKey("rollback-profile");
    try {
      await saveMasterXmlFeed(key, xml([{ id: "old-1", title: "Old" }]));
      const saved = await saveMasterXmlFeed(key, xml([{ id: "new-2", title: "New" }]));
      await rollbackMasterXmlFeed(saved);
      const restored = await readMasterXmlFeed(key);
      expect(restored).toContain("old-1");
      expect(restored).not.toContain("new-2");
    } finally {
      if (previousDirectory === undefined) delete process.env.BOTV_MASTER_FEEDS_DIR;
      else process.env.BOTV_MASTER_FEEDS_DIR = previousDirectory;
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("rebuilds the feed from active autoload ads and drops stale broken blocks", () => {
    const result = reconcileAvitoMasterXml(
      fullXml([
        { id: "active-1", title: "Футболка Keep Me", address: "Москва, ул. Тестовая, 1" },
        { id: "stale-2", title: "Broken old ad", address: "Москва, ул. Тестовая, 1" },
      ]),
      fullXml([{ id: "new-3", title: "Худи New Design", address: "Москва, ул. Тестовая, 1" }]),
      {
        activeListings: [{ avitoId: "100", externalId: "active-1", title: "Футболка Keep Me", address: "Москва, ул. Тестовая, 1" }],
        retiredExternalIds: [],
        activeAds: 1,
        autoloadAds: 1,
        manualAds: 0,
      },
    );

    expect(result.adIds).toEqual(["active-1", "new-3"]);
    expect(result.removedAds).toBe(1);
    expect(result.preservedActiveAds).toBe(1);
  });

  it("skips a repeated drop already active under another XML id", () => {
    const result = reconcileAvitoMasterXml(
      fullXml([{ id: "active-1", title: "Футболка LGB Stars and Beast Edition", address: "Москва, Болотниковская ул., 12", image: "same.jpg" }]),
      fullXml([{ id: "new-2", title: "Лонгслив LGB Stars and Beast", address: "Москва, Болотниковская ул., 12", image: "same.jpg" }]),
      {
        activeListings: [{ avitoId: "100", externalId: "active-1", title: "Футболка LGB Stars and Beast Edition", address: "Москва, Болотниковская ул., 12" }],
        retiredExternalIds: [],
        activeAds: 1,
        autoloadAds: 1,
        manualAds: 0,
      },
    );

    expect(result.adIds).toEqual(["active-1"]);
    expect(result.skippedDuplicateIds).toEqual(["new-2"]);
  });

  it("stops when an active XML ad cannot be reconstructed", () => {
    expect(() => reconcileAvitoMasterXml(null, fullXml([{ id: "new-1", title: "New", address: "Москва" }]), {
      activeListings: [{ avitoId: "100", externalId: "missing-active", title: "Existing", address: "Москва" }],
      retiredExternalIds: [],
      activeAds: 1,
      autoloadAds: 1,
      manualAds: 0,
    })).toThrow(/missing-active/);
  });
});
