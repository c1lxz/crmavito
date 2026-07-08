import { NextResponse } from "next/server";
import { getSession, updateSession } from "@/lib/botv/session";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    return NextResponse.json(await getSession(id));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Сессия не найдена" }, { status: 404 });
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    return NextResponse.json(await updateSession(id, await request.json()));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Ошибка сохранения" }, { status: 500 });
  }
}
