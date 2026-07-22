import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { adsAnalysisInputSchema } from "@/lib/ai/ads-analysis";
import { createClaudeAdsReport, getClaudeStatus } from "@/lib/ai/claude";
import { getGeminiImageStatus } from "@/lib/ai/gemini-images";

export const maxDuration = 120;

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Не авторизован." }, { status: 401 });
  if (session.user.role !== "ADMIN") return NextResponse.json({ error: "Недостаточно прав." }, { status: 403 });
  return NextResponse.json({ claude: getClaudeStatus(), gemini: getGeminiImageStatus() });
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Не авторизован." }, { status: 401 });
  if (session.user.role !== "ADMIN") return NextResponse.json({ error: "Недостаточно прав." }, { status: 403 });

  const parsed = adsAnalysisInputSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Недостаточно данных для AI-анализа." }, { status: 400 });

  try {
    const report = await createClaudeAdsReport(parsed.data);
    return NextResponse.json({ report, generatedAt: new Date().toISOString(), provider: "claude" });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 502 });
  }
}

