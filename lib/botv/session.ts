import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
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
  description: string;
  details: Record<string, string | number>;
}

export interface BotvSession {
  id: string;
  createdAt: number;
  sourceName: string;
  products: BotvProduct[];
  summary: { total: number; active: number; deleted: number; ready: number; photos: number };
  progress: string[];
}

const root = process.cwd();
const botvDir = path.join(root, "botv");
const python = path.join(botvDir, "venv", "bin", "python");
const cli = path.join(botvDir, "web", "session_cli.py");
const uploadDir = path.join(botvDir, "tmp", "web_uploads");

async function runCli(args: string[]) {
  const child = spawn(python, [cli, ...args], { cwd: botvDir, env: process.env });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  const code = await new Promise<number | null>((resolve) => child.on("close", resolve));
  if (code !== 0) throw new Error(stderr.trim() || stdout.trim() || "botv command failed");
  return stdout.trim();
}

export async function createSessionFromFile(file: File): Promise<BotvSession> {
  await mkdir(uploadDir, { recursive: true });
  const safeName = file.name.replace(/[^a-zA-Z0-9а-яА-ЯёЁ._-]+/g, "_");
  const target = path.join(uploadDir, `${Date.now()}_${randomUUID()}_${safeName}`);
  await writeFile(target, Buffer.from(await file.arrayBuffer()));
  return JSON.parse(await runCli(["create", target, file.name])) as BotvSession;
}

export async function createSessionFromLink(link: string): Promise<BotvSession> {
  return JSON.parse(await runCli(["link", link])) as BotvSession;
}

export async function getSession(id: string): Promise<BotvSession> {
  return JSON.parse(await runCli(["state", id])) as BotvSession;
}

export async function updateSession(id: string, payload: unknown): Promise<BotvSession> {
  return JSON.parse(await runCli(["update", id, JSON.stringify(payload)])) as BotvSession;
}

export async function buildXml(id: string, phone?: string): Promise<{ filename: string; xml: string; ads: number; products: number }> {
  const args = ["xml", id];
  if (phone?.trim()) args.push("--phone", phone.trim());
  return JSON.parse(await runCli(args));
}

export async function resolvePhoto(token: string): Promise<string> {
  return runCli(["photo", token]);
}
