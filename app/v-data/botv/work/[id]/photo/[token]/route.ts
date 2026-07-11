import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

const contentType: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};

const botvTmpDir = path.join(process.cwd(), "botv", "tmp", "web_sessions");

function decodePhotoToken(rawToken: string) {
  const token = rawToken.replace(/\.(jpe?g|png|webp)$/i, "");
  const normalized = token.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  return Buffer.from(padded, "base64").toString("utf8");
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string; token: string }> }) {
  try {
    const { id, token } = await params;
    const filePath = path.resolve(decodePhotoToken(token));
    const sessionRoot = path.resolve(botvTmpDir, id);
    const ext = path.extname(filePath).toLowerCase();
    if (!filePath.startsWith(sessionRoot + path.sep) || !(ext in contentType)) {
      return new NextResponse("not found", { status: 404 });
    }
    const body = await readFile(filePath);
    return new NextResponse(body, {
      headers: {
        "content-type": contentType[ext],
        "cache-control": "public, max-age=31536000, immutable",
        "content-length": String(body.length),
      },
    });
  } catch {
    return new NextResponse("not found", { status: 404 });
  }
}
