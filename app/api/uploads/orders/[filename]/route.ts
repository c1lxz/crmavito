import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { NextResponse } from "next/server";
import sharp from "sharp";

const CONTENT_TYPE: Record<string, string> = {
  ".gif": "image/gif",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};

const UPLOAD_DIR = path.join(process.cwd(), "public", "uploads", "orders");

type RouteContext = { params: Promise<{ filename: string }> };

export async function GET(request: Request, { params }: RouteContext) {
  const { filename } = await params;
  const safeName = path.basename(filename);
  const filePath = path.resolve(UPLOAD_DIR, safeName);
  const uploadRoot = path.resolve(UPLOAD_DIR);
  const ext = path.extname(filePath).toLowerCase();

  if (safeName !== filename || !filePath.startsWith(uploadRoot + path.sep) || !(ext in CONTENT_TYPE)) {
    return new NextResponse("not found", { status: 404 });
  }

  try {
    const size = thumbnailSize(request);
    if (size) return await serveThumbnail(filePath, size);
    return await serveOriginal(filePath, ext);
  } catch {
    return new NextResponse("not found", { status: 404 });
  }
}

function thumbnailSize(request: Request) {
  const url = new URL(request.url);
  const enabled = url.searchParams.get("thumb");
  if (enabled !== "1" && enabled !== "true") return null;
  const requested = Number(url.searchParams.get("size") ?? 96);
  if (!Number.isFinite(requested)) return 96;
  return Math.max(40, Math.min(320, Math.round(requested)));
}

async function serveOriginal(filePath: string, ext: string) {
  const fileStat = await stat(filePath);
  const stream = Readable.toWeb(createReadStream(filePath)) as unknown as ReadableStream;
  return new NextResponse(stream, {
    headers: {
      "cache-control": "public, max-age=31536000, immutable",
      "content-length": String(fileStat.size),
      "content-type": CONTENT_TYPE[ext],
    },
  });
}

async function serveThumbnail(filePath: string, size: number) {
  const fileStat = await stat(filePath);
  const cacheDir = path.join(UPLOAD_DIR, ".thumbs");
  const cacheKey = createHash("sha1")
    .update(`${filePath}:${fileStat.size}:${fileStat.mtimeMs}:${size}`)
    .digest("hex");
  const cachePath = path.join(cacheDir, `${cacheKey}.webp`);

  try {
    await stat(cachePath);
  } catch {
    await mkdir(cacheDir, { recursive: true });
    try {
      await sharp(filePath)
        .rotate()
        .resize({ width: size, height: size, fit: "cover", withoutEnlargement: true })
        .webp({ quality: 72, effort: 3 })
        .toFile(cachePath);
    } catch {
      return serveOriginal(filePath, path.extname(filePath).toLowerCase());
    }
  }

  const body = await readFile(cachePath);
  return new NextResponse(body, {
    headers: {
      "cache-control": "public, max-age=31536000, immutable",
      "content-length": String(body.length),
      "content-type": "image/webp",
    },
  });
}
