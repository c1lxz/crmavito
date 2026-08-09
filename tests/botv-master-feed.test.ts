import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  masterFeedKey,
  mergeAvitoMasterXml,
  readMasterXmlFeed,
  rollbackMasterXmlFeed,
  saveMasterXmlFeed,
} from "@/lib/botv/master-xml-feed";

function xml(ads: Array<{ id: string; title: string }>) {
  return `<?xml version="1.0" encoding="UTF-8"?><Ads formatVersion="3" target="Avito.ru">${ads
    .map((ad) => `<Ad><Id>${ad.id}</Id><Title>${ad.title}</Title></Ad>`)
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
});
