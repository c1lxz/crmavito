import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { fetchAvitoAutoloadStatus } from "@/lib/avito/publish";
import { getAvitoCredentials } from "@/lib/avito/profile-store";

export const runtime = "nodejs";
export const maxDuration = 60;

const statusSchema = z.object({
  profileId: z.string().trim().min(1),
});

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Недостаточно прав." }, { status: 403 });
  }

  const parsed = statusSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "Выберите профиль Avito." }, { status: 400 });
  }

  try {
    const credentials = await getAvitoCredentials(parsed.data);
    const status = await fetchAvitoAutoloadStatus(credentials);
    return NextResponse.json({ success: true, status });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 502 },
    );
  }
}
