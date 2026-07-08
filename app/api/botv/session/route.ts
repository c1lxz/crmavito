import { NextResponse } from "next/server";
import { createSessionFromFile } from "@/lib/botv/session";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const file = form.get("archive");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Прикрепи архив" }, { status: 400 });
    }
    const session = await createSessionFromFile(file);
    return NextResponse.json(session);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Ошибка загрузки" }, { status: 500 });
  }
}
