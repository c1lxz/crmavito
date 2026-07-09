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

function decodePhotoToken(token: string) {
  const normalized = token.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  return Buffer.from(padded, "base64").toString("utf8");
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const token = new URL(request.url).searchParams.get("token");
    if (!token) return new NextResponse("not found", { status: 404 });
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
        "cache-control": "private, max-age=86400, immutable",
      },
    });
  } catch {
    return new NextResponse("not found", { status: 404 });
  }
}
