import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { listBackgrounds, parseBackgroundSlot, saveBackground } from "@/lib/ai/content-machine";

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Не авторизован." }, { status: 401 });
  const backgrounds = await listBackgrounds();
  return NextResponse.json({
    backgrounds: backgrounds.map((background, index) => background
      ? { ...background, url: `/api/ai/content-machine/backgrounds/${background.slot}?v=${encodeURIComponent(background.updatedAt)}` }
      : { slot: String(index + 1), fileName: null, mimeType: null, size: 0, updatedAt: null, url: null }),
  });
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Не авторизован." }, { status: 401 });
  if (session.user.role !== "ADMIN") return NextResponse.json({ error: "Недостаточно прав." }, { status: 403 });
  try {
    const form = await request.formData();
    const slot = parseBackgroundSlot(form.get("slot"));
    const file = form.get("file");
    if (!slot || !(file instanceof File)) {
      return NextResponse.json({ error: "Выберите слот и файл фона." }, { status: 400 });
    }
    const background = await saveBackground(slot, file);
    return NextResponse.json({
      background: { ...background, url: `/api/ai/content-machine/backgrounds/${slot}?v=${encodeURIComponent(background.updatedAt)}` },
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}
