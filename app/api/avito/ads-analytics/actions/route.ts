import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db/prisma";
import { adsAnalysisActionSchema } from "@/lib/ai/ads-analysis";
import { ensureTaskNotification } from "@/lib/telegram/task-notification-queue";

const requestSchema = z.object({
  generatedAt: z.string().datetime(),
  actions: z.array(z.object({
    action: adsAnalysisActionSchema,
    listingUrl: z.string().url().nullable().optional(),
  })).min(1).max(20),
});

function taskDescription(
  action: z.infer<typeof adsAnalysisActionSchema>,
  listingUrl: string | null | undefined,
  generatedAt: string,
): string {
  return [
    `AI_ACTION:${generatedAt}:${action.id}`,
    listingUrl ? `Объявление: ${listingUrl}` : `ID объявления: ${action.itemId}`,
    `Направление: ${action.field}`,
    "",
    `Почему: ${action.diagnosis}`,
    action.proposedValue ? `\nЧто сделать:\n${action.proposedValue}` : null,
    `\nКак проверить результат: ${action.expectedImpact}`,
  ].filter(Boolean).join("\n");
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Не авторизован." }, { status: 401 });
  if (session.user.role !== "ADMIN") return NextResponse.json({ error: "Недостаточно прав." }, { status: 403 });

  const parsed = requestSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Не выбраны рекомендации для передачи в работу." }, { status: 400 });

  const dueAt = new Date();
  dueAt.setDate(dueAt.getDate() + 7);
  const createdIds: string[] = [];
  let skipped = 0;

  for (const item of parsed.data.actions) {
    const marker = `AI_ACTION:${parsed.data.generatedAt}:${item.action.id}`;
    const existing = await prisma.task.findFirst({
      where: {
        createdByUserId: session.user.id,
        description: { startsWith: marker },
      },
      select: { id: true },
    });
    if (existing) {
      skipped += 1;
      continue;
    }

    const task = await prisma.task.create({
      data: {
        title: `[Avito] ${item.action.title}`.slice(0, 240),
        description: taskDescription(item.action, item.listingUrl, parsed.data.generatedAt),
        assigneeUserId: session.user.id,
        createdByUserId: session.user.id,
        dueAt,
        assignees: { create: [{ userId: session.user.id }] },
      },
      select: { id: true },
    });
    createdIds.push(task.id);
  }

  await Promise.all(createdIds.map((id) => ensureTaskNotification(id)));

  return NextResponse.json({
    created: createdIds.length,
    skipped,
    taskIds: createdIds,
  });
}
