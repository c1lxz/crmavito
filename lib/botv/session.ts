import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export interface BotvProduct {
  id: string;
  index: number;
  name: string;
  adTitle: string;
  price: number | null;
  deleted: boolean;
  useOriginalTitle: boolean;
  photoCount: number;
  firstPhoto: string | null;
  photos: string[];
  color: "Белый" | "Чёрный";
  description: string;
  descriptionManual?: boolean;
  details: Record<string, string | number>;
}

export interface BotvSession {
  id: string;
  createdAt: number;
  updatedAt: number;
  sourceName: string;
  dropStockQuantity?: number | null;
  products: BotvProduct[];
  summary: { total: number; active: number; deleted: number; ready: number; photos: number };
  progress: string[];
}

export interface BotvSessionHistoryItem {
  id: string;
  createdAt: number;
  updatedAt: number;
  sourceName: string;
  summary: BotvSession["summary"];
}

const root = process.cwd();
const botvDir = path.join(root, "botv");
const python = path.join(botvDir, "venv", "bin", "python");
const cli = path.join(botvDir, "web", "session_cli.py");
const uploadDir = path.join(botvDir, "tmp", "web_uploads");
const publishedFeedsDir = path.join(botvDir, "tmp", "published_feeds");

async function runCli(args: string[]) {
  const child = spawn(python, [cli, ...args], { cwd: botvDir, env: process.env });
  const stdoutChunks: Buffer[] = [];
  const stderrChunks: Buffer[] = [];
  child.stdout.on("data", (chunk: Buffer) => { stdoutChunks.push(chunk); });
  child.stderr.on("data", (chunk: Buffer) => { stderrChunks.push(chunk); });
  const code = await new Promise<number | null>((resolve) => child.on("close", resolve));
  const stdout = Buffer.concat(stdoutChunks).toString("utf8").trim();
  const stderr = Buffer.concat(stderrChunks).toString("utf8").trim();
  if (code !== 0) throw new Error(stderr || stdout || "botv command failed");
  return stdout;
}

export async function createSessionFromFile(file: File): Promise<BotvSession> {
  const target = await reserveUploadTarget(file.name);
  await writeFile(target, Buffer.from(await file.arrayBuffer()));
  return createSessionFromUploadedPath(target, file.name);
}

export async function reserveUploadTarget(sourceName: string): Promise<string> {
  await mkdir(uploadDir, { recursive: true });
  const safeName = sourceName.replace(/[^a-zA-Z0-9._-]+/g, "_") || "archive.zip";
  return path.join(uploadDir, `${Date.now()}_${randomUUID()}_${safeName}`);
}

export async function createSessionFromUploadedPath(filePath: string, sourceName: string): Promise<BotvSession> {
  return JSON.parse(await runCli(["create", filePath, sourceName])) as BotvSession;
}

export async function createSessionFromLink(link: string): Promise<BotvSession> {
  return JSON.parse(await runCli(["link", link])) as BotvSession;
}

export async function getSession(id: string): Promise<BotvSession> {
  return JSON.parse(await runCli(["state", id])) as BotvSession;
}

export async function listSessions(limit = 20): Promise<BotvSessionHistoryItem[]> {
  const raw = JSON.parse(await runCli(["list", "--limit", String(limit)])) as { sessions: BotvSessionHistoryItem[] };
  return raw.sessions;
}

export async function updateSession(id: string, payload: unknown): Promise<BotvSession> {
  return JSON.parse(await runCli(["update", id, JSON.stringify(payload)])) as BotvSession;
}

export function xmlProfileKey(profileId?: string | null): string {
  if (!profileId?.trim()) return "";
  return createHash("sha1").update(profileId.trim()).digest("hex").slice(0, 10);
}

export function xmlIdScopeFromProfile(profileId?: string | null, sessionId?: string | null): string {
  const profile = profileId?.trim();
  if (!profile) return "";
  const drop = sessionId?.trim();
  return createHash("sha1").update(drop ? `${profile}:${drop}` : profile).digest("hex").slice(0, 10);
}

export async function buildXml(
  id: string,
  phone?: string,
  options: { profileId?: string | null } = {},
): Promise<{ filename: string; xml: string; ads: number; products: number; adIds?: string[] }> {
  const args = ["xml", id];
  if (phone?.trim()) args.push("--phone", phone.trim());
  const idScope = xmlIdScopeFromProfile(options.profileId, id);
  if (idScope) args.push("--id-scope", idScope);
  return JSON.parse(await runCli(args));
}

function publishedFeedPath(profileId?: string | null): string | null {
  const profileKey = xmlProfileKey(profileId);
  return profileKey ? path.join(publishedFeedsDir, `${profileKey}.xml`) : null;
}

async function readPreviousPublishedXml(profileId?: string | null): Promise<string | null> {
  const filePath = publishedFeedPath(profileId);
  if (!filePath) return null;
  try {
    return await readFile(filePath, "utf8");
  } catch {
    return null;
  }
}

function extractAdBlocks(xml: string): Array<{ id: string; block: string }> {
  const ads: Array<{ id: string; block: string }> = [];
  for (const match of xml.matchAll(/<Ad\b[\s\S]*?<\/Ad>/g)) {
    const block = match[0];
    const id = block.match(/<Id>([\s\S]*?)<\/Id>/)?.[1]?.trim();
    if (id) ads.push({ id, block });
  }
  return ads;
}

export function mergeAvitoXml(currentXml: string, previousXml?: string | null): { xml: string; ads: number; adIds: string[]; previousAds: number } {
  const currentAds = extractAdBlocks(currentXml);
  const previousAds = previousXml ? extractAdBlocks(previousXml) : [];
  if (!previousAds.length) {
    return { xml: currentXml, ads: currentAds.length, adIds: currentAds.map((ad) => ad.id), previousAds: 0 };
  }

  const seen = new Set(currentAds.map((ad) => ad.id));
  const carriedAds = previousAds.filter((ad) => {
    if (seen.has(ad.id)) return false;
    seen.add(ad.id);
    return true;
  });
  if (!carriedAds.length) {
    return { xml: currentXml, ads: currentAds.length, adIds: currentAds.map((ad) => ad.id), previousAds: 0 };
  }

  const insertAt = currentXml.lastIndexOf("</Ads>");
  const xml = insertAt >= 0
    ? `${currentXml.slice(0, insertAt)}${carriedAds.map((ad) => ad.block).join("")}${currentXml.slice(insertAt)}`
    : currentXml;
  const adIds = [...currentAds.map((ad) => ad.id), ...carriedAds.map((ad) => ad.id)];
  return { xml, ads: adIds.length, adIds, previousAds: carriedAds.length };
}

export async function buildPublicationXml(
  id: string,
  phone?: string,
  options: { profileId?: string | null; includePrevious?: boolean } = {},
): Promise<{ filename: string; xml: string; ads: number; products: number; adIds?: string[]; previousAds: number }> {
  const current = await buildXml(id, phone, { profileId: options.profileId });
  if (!options.includePrevious || !options.profileId) {
    return { ...current, previousAds: 0 };
  }
  const previousXml = await readPreviousPublishedXml(options.profileId);
  const merged = mergeAvitoXml(current.xml, previousXml);
  return {
    ...current,
    xml: merged.xml,
    ads: merged.ads,
    adIds: merged.adIds.length ? merged.adIds : current.adIds,
    previousAds: merged.previousAds,
  };
}

export async function savePublishedXml(profileId: string | null | undefined, xml: string): Promise<void> {
  const filePath = publishedFeedPath(profileId);
  if (!filePath) return;
  await mkdir(publishedFeedsDir, { recursive: true });
  await writeFile(filePath, xml, "utf8");
}

export async function resolvePhoto(token: string): Promise<string> {
  return runCli(["photo", token]);
}
