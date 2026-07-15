import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { fetchAvitoStockItems } from "@/lib/avito/stocks";
import { fetchAvitoAccountProfile } from "@/lib/avito/profile";

export const maxDuration = 300;

const credentialsSchema = z.object({
  clientId: z.string().min(1),
  clientSecret: z.string().min(1),
});

async function requireAdminResponse() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Не авторизован." }, { status: 401 });
  if (session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Недостаточно прав." }, { status: 403 });
  }
  return null;
}

export async function POST(request: Request) {
  const forbidden = await requireAdminResponse();
  if (forbidden) return forbidden;

  const parsed = credentialsSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "Укажите client_id и client_secret Avito." }, { status: 400 });
  }

  try {
    const credentials = {
      clientId: parsed.data.clientId.trim(),
      clientSecret: parsed.data.clientSecret.trim(),
    };
    const [items, profile] = await Promise.all([
      fetchAvitoStockItems(credentials),
      fetchAvitoAccountProfile(credentials),
    ]);
    return NextResponse.json({ items, profile });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 502 },
    );
  }
}
