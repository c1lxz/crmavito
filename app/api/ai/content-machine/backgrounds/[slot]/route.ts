import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { parseBackgroundSlot, readBackground } from "@/lib/ai/content-machine";

export async function GET(_request: Request, context: { params: Promise<{ slot: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Не авторизован." }, { status: 401 });
  const { slot: rawSlot } = await context.params;
  const slot = parseBackgroundSlot(rawSlot);
  if (!slot) return NextResponse.json({ error: "Фон не найден." }, { status: 404 });
  try {
    const background = await readBackground(slot);
    return new NextResponse(new Blob([new Uint8Array(background.buffer)]), {
      headers: {
        "Content-Type": background.mimeType,
        "Content-Length": String(background.size),
        "Cache-Control": "private, no-cache",
      },
    });
  } catch {
    return NextResponse.json({ error: "Фон не найден." }, { status: 404 });
  }
}
