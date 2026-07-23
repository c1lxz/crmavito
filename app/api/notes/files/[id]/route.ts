import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db/prisma";
import { noteStorageDirectory } from "@/lib/notes/storage";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;

  const attachment = await prisma.noteAttachment.findFirst({
    where: {
      id,
      note: {
        OR: [
          { visibility: "ALL" },
          { createdByUserId: session.user.id },
          { viewers: { some: { userId: session.user.id } } },
        ],
      },
    },
  });
  if (!attachment) return NextResponse.json({ error: "Файл не найден" }, { status: 404 });

  try {
    const buffer = await readFile(path.join(noteStorageDirectory(), attachment.storageKey));
    return new NextResponse(buffer, {
      headers: {
        "Content-Type": attachment.mimeType,
        "Content-Length": String(buffer.length),
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(attachment.name)}`,
        "Cache-Control": "private, max-age=3600",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return NextResponse.json({ error: "Файл недоступен" }, { status: 404 });
  }
}
