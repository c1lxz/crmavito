import { createWriteStream } from "node:fs";
import type { IncomingHttpHeaders } from "node:http";
import { createRequire } from "node:module";
import { unlink } from "node:fs/promises";
import { Readable } from "node:stream";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import { NextResponse } from "next/server";
import {
  createSessionFromLink,
  createSessionFromUploadedPath,
  listSessions,
  reserveUploadTarget,
} from "@/lib/botv/session";

export const runtime = "nodejs";
export const maxDuration = 300;

const require = createRequire(import.meta.url);
type BusboyParser = NodeJS.WritableStream & NodeJS.EventEmitter;
const busboy = require("next/dist/compiled/busboy") as (config: {
  headers: IncomingHttpHeaders;
  limits?: Record<string, number>;
}) => BusboyParser;

const MAX_UPLOAD_BYTES = 1536 * 1024 * 1024;

type ParsedUpload = {
  link: string;
  archive: { path: string; name: string } | null;
};

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const limit = Number(url.searchParams.get("limit") ?? 20);
    return NextResponse.json({ sessions: await listSessions(Number.isFinite(limit) ? limit : 20) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Ошибка истории" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  let uploadedPath: string | null = null;

  try {
    const parsed = await parseMultipartUpload(request);
    uploadedPath = parsed.archive?.path ?? null;
    const session = parsed.link
      ? await createSessionFromLink(parsed.link)
      : parsed.archive
        ? await createSessionFromUploadedPath(parsed.archive.path, parsed.archive.name)
        : null;

    if (!session) {
      return NextResponse.json({ error: "Прикрепи архив или ссылку" }, { status: 400 });
    }
    return NextResponse.json(session);
  } catch (error) {
    if (uploadedPath) await unlink(uploadedPath).catch(() => undefined);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Ошибка загрузки" }, { status: 500 });
  }
}

async function parseMultipartUpload(request: Request): Promise<ParsedUpload> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("multipart/form-data")) {
    throw new Error("Ожидалась multipart/form-data загрузка.");
  }
  if (!request.body) throw new Error("Пустое тело запроса.");

  return new Promise((resolve, reject) => {
    const pendingWrites: Promise<void>[] = [];
    const parser = busboy({
      headers: { "content-type": contentType },
      limits: { fields: 5, files: 1, fileSize: MAX_UPLOAD_BYTES },
    });
    let link = "";
    let archive: ParsedUpload["archive"] = null;
    let settled = false;

    function fail(error: Error) {
      if (settled) return;
      settled = true;
      reject(error);
    }

    parser.on("field", (name: string, value: string) => {
      if (name === "link") link = value.trim();
    });

    parser.on("file", (name: string, file: NodeJS.ReadableStream, info: { filename?: string }) => {
      if (name !== "archive") {
        file.resume();
        return;
      }

      const sourceName = info.filename?.trim() || "archive.zip";
      const writePromise = reserveUploadTarget(sourceName).then(
        (target) =>
          new Promise<void>((resolveWrite, rejectWrite) => {
            archive = { path: target, name: sourceName };
            const output = createWriteStream(target);
            file.on("limit", () => rejectWrite(new Error("Архив больше разрешенного лимита 1536 MB.")));
            file.on("error", rejectWrite);
            output.on("error", rejectWrite);
            output.on("finish", resolveWrite);
            file.pipe(output);
          }),
      );
      pendingWrites.push(writePromise);
      writePromise.catch(fail);
    });

    parser.on("finish", () => {
      Promise.all(pendingWrites)
        .then(() => {
          if (!settled) {
            settled = true;
            resolve({ link, archive });
          }
        })
        .catch(fail);
    });
    parser.on("error", fail);

    Readable.fromWeb(request.body as unknown as NodeReadableStream<Uint8Array>).pipe(parser);
  });
}
