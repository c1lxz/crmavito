import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { generateGeminiImage } from "@/lib/ai/gemini-images";

export const maxDuration = 240;

const requestSchema = z.object({
  prompt: z.string().trim().min(20).max(12000),
  aspectRatio: z.enum(["1:1", "3:2", "2:3", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9"]).optional(),
  imageSize: z.enum(["1K", "2K", "4K"]).optional(),
});

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Не авторизован." }, { status: 401 });
  if (session.user.role !== "ADMIN") return NextResponse.json({ error: "Недостаточно прав." }, { status: 403 });
  const parsed = requestSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Проверьте промпт и параметры изображения." }, { status: 400 });

  try {
    const image = await generateGeminiImage(parsed.data);
    return NextResponse.json(image);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 502 });
  }
}
