import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { NextResponse } from "next/server";
import sharp from "sharp";

const contentType: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};

const botvTmpDir = path.join(process.cwd(), "botv", "tmp", "web_sessions");

export function decodePhotoToken(rawToken: string) {
  const token = rawToken.replace(/\.(jpe?g|png|webp)$/i, "");
  const normalized = token.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  return Buffer.from(padded, "base64").toString("utf8");
}

function thumbnailSize(request: Request) {
  const url = new URL(request.url);
  const enabled = url.searchParams.get("thumb");
  if (enabled !== "1" && enabled !== "true") return null;
  const requested = Number(url.searchParams.get("size") ?? 320);
  if (!Number.isFinite(requested)) return 320;
  return Math.max(96, Math.min(1200, Math.round(requested)));
}

async function serveOriginal(filePath: string, ext: string) {
  const fileStat = await stat(filePath);
  const stream = Readable.toWeb(createReadStream(filePath)) as unknown as ReadableStream;
  return new NextResponse(stream, {
    headers: {
      "content-type": contentType[ext],
      "cache-control": "public, max-age=31536000, immutable",
      "content-length": String(fileStat.size),
    },
  });
}

async function serveThumbnail(filePath: string, sessionRoot: string, size: number, ext: string) {
  const fileStat = await stat(filePath);
  const cacheDir = path.join(sessionRoot, ".thumbs");
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
      return serveOriginal(filePath, ext);
    }
  }

  const body = await readFile(cachePath);
  return new NextResponse(body, {
    headers: {
      "content-type": "image/webp",
      "cache-control": "public, max-age=31536000, immutable",
      "content-length": String(body.length),
    },
  });
}

export async function serveBotvPhoto(request: Request, id: string, rawToken: string | null) {
  try {
    if (!rawToken) return new NextResponse("not found", { status: 404 });
    const filePath = path.resolve(decodePhotoToken(rawToken));
    const sessionRoot = path.resolve(botvTmpDir, id);
    const ext = path.extname(filePath).toLowerCase();
    if (!filePath.startsWith(sessionRoot + path.sep) || !(ext in contentType)) {
      return new NextResponse("not found", { status: 404 });
    }

    const size = thumbnailSize(request);
    if (size) {
      return await serveThumbnail(filePath, sessionRoot, size, ext);
    }
    return await serveOriginal(filePath, ext);
  } catch {
    return new NextResponse("not found", { status: 404 });
  }
}
