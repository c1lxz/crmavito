import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { probeAvitoPublicPage } from "@/lib/avito/market-analysis";

export const maxDuration = 30;

const probeSchema = z.object({
  category: z.string().min(1),
  periodDays: z.coerce.number().int().min(1).max(30).default(3),
});

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Не авторизован." }, { status: 401 });
  if (session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Недостаточно прав." }, { status: 403 });
  }

  const parsed = probeSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "Укажите категорию и период." }, { status: 400 });
  }

  try {
    const result = await probeAvitoPublicPage(parsed.data);
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
