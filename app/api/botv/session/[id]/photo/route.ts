import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { resolvePhoto } from "@/lib/botv/session";

export const runtime = "nodejs";

const contentType: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};

export async function GET(request: Request) {
  try {
    const token = new URL(request.url).searchParams.get("token");
    if (!token) return new NextResponse("not found", { status: 404 });
    const filePath = await resolvePhoto(token);
    const body = await readFile(filePath);
    return new NextResponse(body, {
      headers: {
        "content-type": contentType[path.extname(filePath).toLowerCase()] ?? "application/octet-stream",
        "cache-control": "private, max-age=3600",
      },
    });
  } catch {
    return new NextResponse("not found", { status: 404 });
  }
}
