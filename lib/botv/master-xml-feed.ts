import { createHash, randomUUID } from "node:crypto";
import { copyFile, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { inspectAvitoXml } from "@/lib/botv/custom-xml-feed";

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
}): Promise<MasterXmlMerge> {
  let previousXml = await readMasterXmlFeedIfExists(options.key);
  if (!previousXml && options.bootstrapFeedUrl) previousXml = await fetchBootstrapXml(options.bootstrapFeedUrl);
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
