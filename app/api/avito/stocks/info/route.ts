import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { fetchAvitoStocksInfo, getAvitoStockToken } from "@/lib/avito/stocks";
import { getAvitoCredentials } from "@/lib/avito/profile-store";

export const maxDuration = 60;

const stockInfoSchema = z.object({
  profileId: z.string().trim().min(1),
  itemIds: z.array(z.string().trim().min(1)).min(1).max(50),
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

  const parsed = stockInfoSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "Передайте профиль Avito и список объявлений." }, { status: 400 });
  }

  try {
    const credentials = await getAvitoCredentials({ profileId: parsed.data.profileId });
    const token = await getAvitoStockToken(credentials);
    const result = await fetchAvitoStocksInfo(token, parsed.data.itemIds, {
      stockDelayMs: 350,
      stockDeadlineMs: 25_000,
    });

    return NextResponse.json({
      stocks: [...result.stocks.values()],
      warning: result.warning,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 502 },
    );
  }
}
