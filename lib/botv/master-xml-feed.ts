import { createHash, randomUUID } from "node:crypto";
import { copyFile, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { inspectAvitoXml } from "@/lib/botv/custom-xml-feed";
import type { AvitoProfileInventory, AvitoProfileListing } from "@/lib/avito/profile-inventory";

const defaultFeedsDir = path.join(process.cwd(), "data", "botv", "master_xml_feeds");
const MAX_BOOTSTRAP_BYTES = 50 * 1024 * 1024;

export type MasterXmlMerge = {
  xml: string;
  ads: number;
  adIds: string[];
  previousAds: number;
  addedAds: number;
  updatedAds: number;
  removedAds: number;
  skippedDuplicateAds?: number;
  skippedDuplicateIds?: string[];
  skippedRetiredIds?: string[];
  activeProfileAds?: number;
  manualProfileAds?: number;
  preservedActiveAds?: number;
};

export type SavedMasterXml = {
  key: string;
  previousXml: string | null;
};

function feedsDir(): string {
  return process.env.BOTV_MASTER_FEEDS_DIR?.trim() || defaultFeedsDir;
}

export function masterFeedKey(profileIdentity: string): string {
  const value = profileIdentity.trim();
  if (!value) throw new Error("Для безопасного мастер-фида нужен профиль Avito.");
  return createHash("sha256").update(value).digest("hex").slice(0, 24);
}

function validateKey(key: string): string {
  if (!/^[0-9a-f]{24}$/.test(key)) throw new Error("Некорректный ключ мастер-фида.");
  return key;
}

function feedPath(key: string): string {
  return path.join(feedsDir(), `${validateKey(key)}.xml`);
}

function adBlocks(xml: string): Array<{ id: string; xml: string }> {
  return Array.from(xml.matchAll(/<Ad\b[^>]*>[\s\S]*?<\/Ad>/gi), (match) => {
    const id = match[0].match(/<Id>([^<]+)<\/Id>/i)?.[1]?.trim();
    if (!id) throw new Error("В объявлении мастер-фида отсутствует Id.");
    return { id, xml: match[0] };
  });
}

function decodeXmlText(value: string): string {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'");
}

function field(block: string, name: string): string {
  return decodeXmlText(block.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`, "i"))?.[1]?.trim() ?? "");
}

function normalizedTitle(value: string): string {
  return value
    .toLocaleLowerCase("ru-RU")
    .replace(/\b(?:футболк[аи]?|лонгслив(?:ы)?|худи|свитшот(?:ы)?|толстовк[аи]?|поло|майк[аи]?)\b/giu, " ")
    .replace(/\b(?:edition|type)\b/giu, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function normalizedAddress(value: string): string {
  return value.toLocaleLowerCase("ru-RU").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

function imageBasename(block: string): string {
  const raw = block.match(/<Image\b[^>]*\burl=["']([^"']+)["']/i)?.[1]?.trim();
  if (!raw) return "";
  try {
    return decodeURIComponent(new URL(decodeXmlText(raw)).pathname.split("/").pop() ?? "").toLocaleLowerCase("ru-RU");
  } catch {
    return raw.split(/[/?#]/).filter(Boolean).pop()?.toLocaleLowerCase("ru-RU") ?? "";
  }
}

function duplicateKeys(title: string, address: string, block?: string): string[] {
  const normalizedLocation = normalizedAddress(address);
  const keys: string[] = [];
  const titleKey = normalizedTitle(title);
  if (titleKey && normalizedLocation) keys.push(`title:${titleKey}|${normalizedLocation}`);
  const imageKey = block ? imageBasename(block) : "";
  if (imageKey && normalizedLocation) keys.push(`image:${imageKey}|${normalizedLocation}`);
  return keys;
}

function listingKeys(listing: AvitoProfileListing, block?: string): string[] {
  return duplicateKeys(listing.title || (block ? field(block, "Title") : ""), listing.address || (block ? field(block, "Address") : ""), block);
}

export function reconcileAvitoMasterXml(
  previousValue: string | null,
  incomingValue: string,
  inventory: AvitoProfileInventory,
): MasterXmlMerge {
  const incoming = inspectAvitoXml(incomingValue);
  const previous = previousValue ? inspectAvitoXml(previousValue) : null;
  const previousBlocks = new Map(adBlocks(previous?.xml ?? "").map((ad) => [ad.id, ad.xml]));
  const incomingBlocks = new Map(adBlocks(incoming.xml).map((ad) => [ad.id, ad.xml]));
  const activeExternalIds = new Set(
    inventory.activeListings.map((item) => item.externalId).filter((id): id is string => Boolean(id)),
  );
  const missingActiveIds = [...activeExternalIds].filter((id) => !previousBlocks.has(id) && !incomingBlocks.has(id));
  if (missingActiveIds.length) {
    throw new Error(
      `Безопасная публикация остановлена: для ${missingActiveIds.length} активных объявлений не найден исходный XML (${missingActiveIds.slice(0, 10).join(", ")}).`,
    );
  }

  const merged = new Map<string, string>();
  for (const id of activeExternalIds) {
    const block = incomingBlocks.get(id) ?? previousBlocks.get(id);
    if (block) merged.set(id, block);
  }

  const knownDuplicateKeys = new Set<string>();
  for (const listing of inventory.activeListings) {
    const block = listing.externalId ? merged.get(listing.externalId) : undefined;
    for (const key of listingKeys(listing, block)) knownDuplicateKeys.add(key);
  }

  const retired = new Set(inventory.retiredExternalIds);
  const skippedDuplicateIds: string[] = [];
  const skippedRetiredIds: string[] = [];
  let updatedAds = 0;
  for (const ad of adBlocks(incoming.xml)) {
    if (activeExternalIds.has(ad.id)) {
      merged.set(ad.id, ad.xml);
      updatedAds += 1;
      continue;
    }
    if (retired.has(ad.id)) {
      skippedRetiredIds.push(ad.id);
      continue;
    }
    const keys = duplicateKeys(field(ad.xml, "Title"), field(ad.xml, "Address"), ad.xml);
    if (keys.some((key) => knownDuplicateKeys.has(key))) {
      skippedDuplicateIds.push(ad.id);
      continue;
    }
    merged.set(ad.id, ad.xml);
    for (const key of keys) knownDuplicateKeys.add(key);
  }

  const root = incoming.xml.match(/<Ads\b[^>]*>/i)?.[0] || '<Ads formatVersion="3" target="Avito.ru">';
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n${root}\n${Array.from(merged.values()).join("\n")}\n</Ads>`;
  const inspected = inspectAvitoXml(xml);
  const retainedPreviousIds = inspected.adIds.filter((id) => previousBlocks.has(id)).length;
  return {
    ...inspected,
    previousAds: previousBlocks.size,
    addedAds: inspected.adIds.filter((id) => !previousBlocks.has(id)).length,
    updatedAds,
    removedAds: previousBlocks.size - retainedPreviousIds,
    skippedDuplicateAds: skippedDuplicateIds.length,
    skippedDuplicateIds,
    skippedRetiredIds,
    activeProfileAds: inventory.activeAds,
    manualProfileAds: inventory.manualAds,
    preservedActiveAds: activeExternalIds.size,
  };
}

export function mergeAvitoMasterXml(previousValue: string | null, incomingValue: string): MasterXmlMerge {
  const incoming = inspectAvitoXml(incomingValue);
  const previous = previousValue ? inspectAvitoXml(previousValue) : null;
  const merged = new Map<string, string>();
  for (const ad of previous ? adBlocks(previous.xml) : []) merged.set(ad.id, ad.xml);
  const previousIds = new Set(merged.keys());
  let updatedAds = 0;
  for (const ad of adBlocks(incoming.xml)) {
    if (previousIds.has(ad.id)) updatedAds += 1;
    merged.set(ad.id, ad.xml);
  }

  const root = incoming.xml.match(/<Ads\b[^>]*>/i)?.[0] || '<Ads formatVersion="3" target="Avito.ru">';
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n${root}\n${Array.from(merged.values()).join("\n")}\n</Ads>`;
  const inspected = inspectAvitoXml(xml);
  const removedAds = previousIds.size - inspected.adIds.filter((id) => previousIds.has(id)).length;
  if (removedAds !== 0) {
    throw new Error(`Безопасная публикация остановлена: из мастер-фида исчезают ${removedAds} старых объявлений.`);
  }
  return {
    ...inspected,
    previousAds: previousIds.size,
    addedAds: inspected.adIds.filter((id) => !previousIds.has(id)).length,
    updatedAds,
    removedAds,
  };
}

export async function readMasterXmlFeed(key: string): Promise<string> {
  return readFile(feedPath(key), "utf8");
}

export async function readMasterXmlFeedIfExists(key: string): Promise<string | null> {
  return readMasterXmlFeed(key).catch((error: NodeJS.ErrnoException) => {
    if (error?.code === "ENOENT") return null;
    throw error;
  });
}

export async function fetchBootstrapXml(feedUrl?: string | null): Promise<string | null> {
  if (!feedUrl) return null;
  const url = new URL(feedUrl);
  if (url.protocol !== "https:") throw new Error("Исходный XML-фид Avito должен использовать HTTPS.");
  const host = url.hostname.toLowerCase();
  if (host === "localhost" || host === "127.0.0.1" || host === "::1" || host.endsWith(".local")) {
    throw new Error("Нельзя загрузить исходный XML-фид с локального адреса.");
  }
  const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`Не удалось прочитать текущий XML-фид Avito: HTTP ${response.status}.`);
  const length = Number(response.headers.get("content-length") || 0);
  if (length > MAX_BOOTSTRAP_BYTES) throw new Error("Текущий XML-фид Avito больше 50 МБ.");
  return inspectAvitoXml(await response.text()).xml;
}

export async function prepareMasterXmlFeed(options: {
  key: string;
  incomingXml: string;
  bootstrapFeedUrl?: string | null;
  profileInventory?: AvitoProfileInventory;
}): Promise<MasterXmlMerge> {
  let previousXml = await readMasterXmlFeedIfExists(options.key);
  if (!previousXml && options.bootstrapFeedUrl) previousXml = await fetchBootstrapXml(options.bootstrapFeedUrl);
  if (options.profileInventory) return reconcileAvitoMasterXml(previousXml, options.incomingXml, options.profileInventory);
  return mergeAvitoMasterXml(previousXml, options.incomingXml);
}

export async function saveMasterXmlFeed(key: string, xml: string): Promise<SavedMasterXml> {
  const target = feedPath(key);
  const previousXml = await readMasterXmlFeedIfExists(key);
  await mkdir(feedsDir(), { recursive: true });
  if (previousXml) {
    const historyDir = path.join(feedsDir(), "history", validateKey(key));
    await mkdir(historyDir, { recursive: true });
    await copyFile(target, path.join(historyDir, `${Date.now()}-${randomUUID()}.xml`));
  }
  const temporary = `${target}.${randomUUID()}.tmp`;
  await writeFile(temporary, inspectAvitoXml(xml).xml, "utf8");
  await rename(temporary, target);
  return { key, previousXml };
}

export async function rollbackMasterXmlFeed(saved: SavedMasterXml): Promise<void> {
  const target = feedPath(saved.key);
  if (saved.previousXml == null) {
    await rm(target, { force: true });
    return;
  }
  const temporary = `${target}.${randomUUID()}.rollback.tmp`;
  await writeFile(temporary, saved.previousXml, "utf8");
  await rename(temporary, target);
}
