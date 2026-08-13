import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
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
  locations: BotvLocation[];
  products: BotvProduct[];
  summary: { total: number; active: number; deleted: number; ready: number; photos: number };
  progress: string[];
}

export interface BotvLocation {
  city: string;
  address: string;
  enabled: boolean;
  custom?: boolean;
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
const staleUploadAgeMs = 24 * 60 * 60 * 1000;
const sessionUpdateQueues = new Map<string, Promise<unknown>>();

export async function pruneStaleUploadEntries(directory: string, maxAgeMs = staleUploadAgeMs) {
  await mkdir(directory, { recursive: true });
  const cutoff = Date.now() - maxAgeMs;
  const entries = await readdir(directory).catch(() => []);
  await Promise.all(entries.map(async (entry) => {
    const target = path.resolve(directory, entry);
    if (!target.startsWith(path.resolve(directory) + path.sep)) return;
    const details = await stat(target).catch(() => null);
    if (details && details.mtimeMs < cutoff) {
      await rm(target, { recursive: true, force: true });
    }
  }));
}

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
  await pruneStaleUploadEntries(uploadDir);
  const safeName = sourceName.replace(/[^a-zA-Z0-9._-]+/g, "_") || "archive.zip";
  return path.join(uploadDir, `${Date.now()}_${randomUUID()}_${safeName}`);
}

export async function createSessionFromUploadedPath(filePath: string, sourceName: string): Promise<BotvSession> {
  return JSON.parse(await runCli(["create-move", filePath, sourceName])) as BotvSession;
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
  const previous = sessionUpdateQueues.get(id) ?? Promise.resolve();
  const update = previous.catch(() => undefined).then(async () => (
    JSON.parse(await runCli(["update", id, JSON.stringify(payload)])) as BotvSession
  ));
  sessionUpdateQueues.set(id, update);
  try {
    return await update;
  } finally {
    if (sessionUpdateQueues.get(id) === update) sessionUpdateQueues.delete(id);
  }
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

export async function resolvePhoto(token: string): Promise<string> {
  return runCli(["photo", token]);
}
