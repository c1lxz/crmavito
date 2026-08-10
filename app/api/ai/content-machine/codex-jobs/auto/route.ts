import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { createAnalyticsDesignJobs } from "@/lib/ai/content-machine-auto";

export const maxDuration = 300;

const requestSchema = z.object({
  designCount: z.coerce.number().int().min(1).max(100),
  imageSize: z.enum(["2K", "4K"]).default("2K"),
  periodDays: z.coerce.number().int().min(7).max(270).default(30),
  profileName: z.string().trim().min(1).max(100).optional(),
  garmentType: z.enum(["t-shirt"]).optional(),
});

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Не авторизован." }, { status: 401 });

  const parsed = requestSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "Количество позиций должно быть от 1 до 100." }, { status: 400 });
  }

  try {
    const batch = await createAnalyticsDesignJobs(parsed.data);
    return NextResponse.json({
      batchId: `CMB-${Date.now().toString(36).toUpperCase()}`,
      jobs: batch.jobs,
      jobIds: batch.jobs.map((job) => job.id),
      winners: batch.winners,
      periodDays: batch.periodDays,
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 502 });
  }
}
