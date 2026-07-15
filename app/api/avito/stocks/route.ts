import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { fetchAvitoStockItems } from "@/lib/avito/stocks";
import { fetchAvitoAccountProfile } from "@/lib/avito/profile";
import { getAvitoCredentials, saveAvitoProfileCredentials } from "@/lib/avito/profile-store";

export const maxDuration = 300;

const credentialsSchema = z.object({
  profileId: z.string().trim().optional(),
  clientId: z.string().trim().optional(),
  clientSecret: z.string().trim().optional(),
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
    const [items, profile] = await Promise.all([
      fetchAvitoStockItems(credentials),
      fetchAvitoAccountProfile(credentials),
    ]);
    const savedProfile = await saveAvitoProfileCredentials(credentials, profile);
    return NextResponse.json({ items, profile: savedProfile });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 502 },
    );
  }
}
