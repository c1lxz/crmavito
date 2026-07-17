import type { Dirent } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

type XmlFile = { path: string; mtimeMs: number };
type Cache = {
  expiresAt: number;
  root: string;
  maxFiles: number;
  imagesByExternalId: Map<string, string>;
  imagesByTitle: Map<string, string>;
};

let cache: Cache | null = null;

const CACHE_TTL_MS = 60_000;
const DEFAULT_MAX_XML_FILES = 200;

function sessionsRoot(): string {
  return process.env.BOTV_WEB_SESSIONS_DIR?.trim()
    || path.join(process.cwd(), "botv", "tmp", "web_sessions");
}

function maxXmlFiles(): number {
  const value = Number(process.env.BOTV_IMAGE_XML_SCAN_LIMIT);
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_MAX_XML_FILES;
}

function normalizeTitle(value: string): string {
  return value
    .toLowerCase()
    .replace(/[ё]/g, "е")
    .replace(/[“”„«»]/g, "\"")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeExternalId(value: string): string {
  return value.trim().toLowerCase();
}

function decodeXml(value: string): string {
  return value
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .trim();
}

function normalizeImageUrl(value: string): string {
  try {
    const url = new URL(value);
    const appUrl = process.env.NEXTAUTH_URL || process.env.APP_URL || "https://crmavito.duckdns.org";
    const appHost = new URL(appUrl).host;
    if (url.protocol === "http:" && url.host === appHost) {
      url.protocol = "https:";
      return url.toString();
    }
  } catch {
    return value;
  }
  return value;
}

async function collectXmlFiles(root: string): Promise<XmlFile[]> {
  const files: XmlFile[] = [];
  const stack = [root];

  while (stack.length) {
    const dir = stack.pop()!;
    let entries: Dirent[];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
        continue;
      }
      if (!entry.isFile() || !entry.name.endsWith(".xml")) continue;
      const info = await stat(fullPath).catch(() => null);
      if (info) files.push({ path: fullPath, mtimeMs: info.mtimeMs });
    }
  }

  return files.sort((a, b) => b.mtimeMs - a.mtimeMs);
}

function indexXml(
  xml: string,
  imagesByExternalId: Map<string, string>,
  imagesByTitle: Map<string, string>,
): void {
  for (const adMatch of xml.matchAll(/<Ad\b[\s\S]*?<\/Ad>/g)) {
    const ad = adMatch[0];
    const id = ad.match(/<Id>([\s\S]*?)<\/Id>/i)?.[1];
    const title = ad.match(/<Title>([\s\S]*?)<\/Title>/)?.[1];
    const image = ad.match(/<Image\b[^>]*\burl=(["'])(.*?)\1/i)?.[2];
    if (!image) continue;

    const imageUrl = normalizeImageUrl(decodeXml(image));
    if (id) {
      const normalizedId = normalizeExternalId(decodeXml(id));
      if (normalizedId && !imagesByExternalId.has(normalizedId)) {
        imagesByExternalId.set(normalizedId, imageUrl);
      }
    }

    if (title) {
      const normalizedTitle = normalizeTitle(decodeXml(title));
      if (normalizedTitle && !imagesByTitle.has(normalizedTitle)) {
        imagesByTitle.set(normalizedTitle, imageUrl);
      }
    }
  }
}

async function buildIndex(): Promise<Cache> {
  const root = sessionsRoot();
  const maxFiles = maxXmlFiles();
  const imagesByExternalId = new Map<string, string>();
  const imagesByTitle = new Map<string, string>();
  const xmlFiles = (await collectXmlFiles(root)).slice(0, maxFiles);

  for (const file of xmlFiles) {
    const xml = await readFile(file.path, "utf8").catch(() => "");
    if (xml) indexXml(xml, imagesByExternalId, imagesByTitle);
  }

  return {
    expiresAt: Date.now() + CACHE_TTL_MS,
    root,
    maxFiles,
    imagesByExternalId,
    imagesByTitle,
  };
}

async function getIndex(): Promise<Cache> {
  const root = sessionsRoot();
  const maxFiles = maxXmlFiles();
  if (cache && cache.expiresAt > Date.now() && cache.root === root && cache.maxFiles === maxFiles) {
    return cache;
  }
  cache = await buildIndex();
  return cache;
}

export function __resetBotvImageCacheForTests(): void {
  cache = null;
}

export async function findBotvImageByTitle(title: string | null | undefined): Promise<string | null> {
  if (!title?.trim()) return null;
  const index = await getIndex();
  return index.imagesByTitle.get(normalizeTitle(title)) ?? null;
}

export async function findBotvImageByExternalId(externalId: string | null | undefined): Promise<string | null> {
  if (!externalId?.trim()) return null;
  const index = await getIndex();
  return index.imagesByExternalId.get(normalizeExternalId(externalId)) ?? null;
}
