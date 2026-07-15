import { appendFile, mkdir, readFile, rm, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { createSessionFromUploadedPath, reserveUploadTarget } from "@/lib/botv/session";

export const runtime = "nodejs";
export const maxDuration = 300;

const chunkRoot = path.join(process.cwd(), "botv", "tmp", "web_chunk_uploads");
const maxChunks = 20000;

function safeUploadId(value: FormDataEntryValue | null) {
  const text = typeof value === "string" ? value : "";
  if (!/^[a-zA-Z0-9_-]{8,80}$/.test(text)) throw new Error("Некорректная сессия загрузки.");
  return text;
}

function field(form: FormData, name: string) {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
}

function numberField(form: FormData, name: string) {
  const value = Number(field(form, name));
  if (!Number.isInteger(value) || value < 0) throw new Error("Некорректный номер части архива.");
  return value;
}

async function chunkDir(uploadId: string) {
  const dir = path.resolve(chunkRoot, uploadId);
  if (!dir.startsWith(path.resolve(chunkRoot) + path.sep)) throw new Error("Некорректная сессия загрузки.");
  await mkdir(dir, { recursive: true });
  return dir;
}

async function saveChunk(form: FormData) {
  const uploadId = safeUploadId(form.get("uploadId"));
  const index = numberField(form, "index");
  const totalChunks = numberField(form, "totalChunks");
  const chunk = form.get("chunk");
  if (totalChunks < 1 || totalChunks > maxChunks || index >= totalChunks) {
    throw new Error("Некорректное количество частей архива.");
  }
  if (!(chunk instanceof File)) throw new Error("Часть архива не найдена.");

  const dir = await chunkDir(uploadId);
  await writeFile(path.join(dir, `${String(index).padStart(6, "0")}.part`), Buffer.from(await chunk.arrayBuffer()));
  return NextResponse.json({ ok: true, index });
}

async function finalizeUpload(form: FormData) {
  const uploadId = safeUploadId(form.get("uploadId"));
  const fileName = field(form, "fileName") || "archive.zip";
  const totalChunks = numberField(form, "totalChunks");
  if (totalChunks < 1 || totalChunks > maxChunks) throw new Error("Некорректное количество частей архива.");

  const dir = await chunkDir(uploadId);
  const target = await reserveUploadTarget(fileName);
  try {
    await writeFile(target, "");
    for (let index = 0; index < totalChunks; index += 1) {
      const part = path.join(dir, `${String(index).padStart(6, "0")}.part`);
      await appendFile(target, await readFile(part));
    }
    const session = await createSessionFromUploadedPath(target, fileName);
    await rm(dir, { recursive: true, force: true });
    return NextResponse.json(session);
  } catch (error) {
    await unlink(target).catch(() => undefined);
    throw error;
  }
}

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const action = field(form, "action");
    if (action === "chunk") return await saveChunk(form);
    if (action === "finalize") return await finalizeUpload(form);
    return NextResponse.json({ error: "Неизвестное действие загрузки." }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Ошибка загрузки архива" }, { status: 500 });
  }
}
