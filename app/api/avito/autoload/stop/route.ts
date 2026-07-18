import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { disableAvitoAutoload } from "@/lib/avito/publish";
import { getAvitoCredentials, getAvitoProfileReportEmail } from "@/lib/avito/profile-store";

export const runtime = "nodejs";
export const maxDuration = 120;

const stopSchema = z.object({
  profileId: z.string().trim().optional().nullable(),
  clientId: z.string().trim().optional().nullable(),
  clientSecret: z.string().trim().optional().nullable(),
  reportEmail: z.string().trim().email().optional().nullable(),
});

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Недостаточно прав." }, { status: 403 });
  }

  const parsed = stopSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "Выберите профиль Avito." }, { status: 400 });
  }

  try {
    const credentials = await getAvitoCredentials(parsed.data);
    const savedReportEmail = await getAvitoProfileReportEmail(parsed.data.profileId);
    const reportEmail = parsed.data.reportEmail?.trim() || savedReportEmail;
    const result = await disableAvitoAutoload(credentials, { reportEmail });
    return NextResponse.json({
      success: true,
      message: "Автозагрузка отключена, XML-фид очищен. Уже запущенная обработка Avito может завершиться отдельно.",
      stop: result,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 502 },
    );
  }
}
