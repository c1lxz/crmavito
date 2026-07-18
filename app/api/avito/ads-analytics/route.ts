import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { getAvitoCredentials } from "@/lib/avito/profile-store";
import { fetchAvitoAdsAnalytics } from "@/lib/avito/ads-analytics";

export const maxDuration = 60;

const analyticsSchema = z.object({
  profileId: z.string().trim().min(1),
  periodDays: z.coerce.number().int().min(1).max(270).default(3),
});

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Не авторизован." }, { status: 401 });
  if (session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Недостаточно прав." }, { status: 403 });
  }

  const parsed = analyticsSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "Выберите профиль Avito и период." }, { status: 400 });
  }

  try {
    const credentials = await getAvitoCredentials({ profileId: parsed.data.profileId });
    const result = await fetchAvitoAdsAnalytics({
      profileId: parsed.data.profileId,
      credentials,
      periodDays: parsed.data.periodDays,
    });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 502 },
    );
  }
}
