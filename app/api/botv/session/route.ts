import { NextResponse } from "next/server";
import { createSessionFromFile, createSessionFromLink } from "@/lib/botv/session";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const link = String(form.get("link") ?? "").trim();
    const file = form.get("archive");
    const session = link
      ? await createSessionFromLink(link)
      : file instanceof File
        ? await createSessionFromFile(file)
        : null;
    if (!session) {
      return NextResponse.json({ error: "Прикрепи архив или ссылку" }, { status: 400 });
    }
    return NextResponse.json(session);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Ошибка загрузки" }, { status: 500 });
  }
}
