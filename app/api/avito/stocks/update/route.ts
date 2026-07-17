import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { updateAvitoStocks } from "@/lib/avito/stocks";
import { getAvitoCredentials } from "@/lib/avito/profile-store";

export const maxDuration = 300;

const updateSchema = z.object({
  profileId: z.string().trim().min(1),
  updates: z
    .array(
      z.object({
        itemId: z.string().min(1),
        quantity: z.number().int().min(0),
      }),
    )
    .min(1)
    .max(2000),
});

async function requireAdminResponse() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Не авторизован." }, { status: 401 });
  if (session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Недостаточно прав." }, { status: 403 });
  }
  return null;
}

export async function PUT(request: Request) {
  const forbidden = await requireAdminResponse();
  if (forbidden) return forbidden;

  const parsed = updateSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "Проверьте ключи Avito и остатки." }, { status: 400 });
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
    const result = await updateAvitoStocks(credentials, parsed.data.updates);
    return NextResponse.json({ stocks: result });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 502 },
    );
  }
}
