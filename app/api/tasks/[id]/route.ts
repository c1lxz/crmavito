import { NextRequest, NextResponse } from "next/server";
import { TaskStatus } from "@prisma/client";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db/prisma";
import {
  completeTaskNotification,
  ensureTaskNotification,
} from "@/lib/telegram/task-notification-queue";
import { serializeTask } from "@/lib/tasks/serialize";

const taskInclude = {
  assignee: { select: { id: true, name: true, telegramId: true } },
  createdBy: { select: { id: true, name: true } },
  completedBy: { select: { id: true, name: true } },
  notification: {
    select: {
      status: true,
      sentAt: true,
      lastError: true,
      telegramMessageId: true,
    },
  },
} as const;

const updateSchema = z.object({
  title: z.string().trim().min(2).optional(),
  description: z.string().trim().nullable().optional(),
  assigneeUserId: z.string().uuid().optional(),
  dueAt: z.string().datetime().optional(),
  scheduledAt: z.string().datetime().nullable().optional(),
  status: z.nativeEnum(TaskStatus).optional(),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const parsed = updateSchema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  if (parsed.data.assigneeUserId) {
    const assignee = await prisma.user.findFirst({
      where: { id: parsed.data.assigneeUserId, isActive: true },
      select: { id: true },
    });
    if (!assignee) {
      return NextResponse.json({ error: "Ответственный не найден" }, { status: 404 });
    }
  }

  const completing = parsed.data.status === "COMPLETED";
  const reopening = parsed.data.status === "OPEN";

  const task = await prisma.task.update({
    where: { id },
    data: {
      ...(parsed.data.title !== undefined ? { title: parsed.data.title } : {}),
      ...(parsed.data.description !== undefined
        ? { description: parsed.data.description || null }
        : {}),
      ...(parsed.data.assigneeUserId !== undefined
        ? { assigneeUserId: parsed.data.assigneeUserId }
        : {}),
      ...(parsed.data.dueAt !== undefined ? { dueAt: new Date(parsed.data.dueAt) } : {}),
      ...(parsed.data.scheduledAt !== undefined
        ? {
            scheduledAt: parsed.data.scheduledAt
              ? new Date(parsed.data.scheduledAt)
              : null,
          }
        : {}),
      ...(parsed.data.status !== undefined ? { status: parsed.data.status } : {}),
      ...(completing
        ? { completedAt: new Date(), completedByUserId: session.user.id }
        : {}),
      ...(reopening ? { completedAt: null, completedByUserId: null } : {}),
    },
    include: taskInclude,
  });

  if (completing) {
    await completeTaskNotification(task.id);
  } else if (reopening || parsed.data.assigneeUserId || parsed.data.scheduledAt) {
    await ensureTaskNotification(task.id);
  }

  const fresh = await prisma.task.findUniqueOrThrow({
    where: { id: task.id },
    include: taskInclude,
  });
  return NextResponse.json(serializeTask(fresh));
}
