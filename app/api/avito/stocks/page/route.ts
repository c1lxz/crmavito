import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { fetchAvitoItemsPage } from "@/lib/avito/sync";
import { avitoListItemToStockItem, getAvitoStockToken } from "@/lib/avito/stocks";
import { getAvitoCredentials } from "@/lib/avito/profile-store";

export const maxDuration = 60;

const requestSchema = z.object({
  profileId: z.string().trim().optional().nullable(),
  clientId: z.string().trim().optional().nullable(),
  clientSecret: z.string().trim().optional().nullable(),
  page: z.coerce.number().int().min(1).max(520).default(1),
  perPage: z.coerce.number().int().min(1).max(25).default(25),
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

  const parsed = requestSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "Выберите профиль Avito." }, { status: 400 });
  }

  let credentials;
  try {
    credentials = await getAvitoCredentials(parsed.data);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 400 },
    );
  }

  try {
    const token = await getAvitoStockToken(credentials, { attempts: 1 });
    const result = await fetchAvitoItemsPage(token, {
      page: parsed.data.page,
      perPage: parsed.data.perPage,
      status: "active",
      requestAttempts: 1,
      requestTimeoutMs: 20_000,
    });

    return NextResponse.json({
      page: result.page,
      perPage: result.perPage,
      items: result.items.map((item) => avitoListItemToStockItem(item)),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 502 },
    );
  }
}
