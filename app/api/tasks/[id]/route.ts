import { NextRequest, NextResponse } from "next/server";
import { TaskStatus } from "@prisma/client";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db/prisma";
import {
  completeTaskNotification,
  ensureTaskNotification,
  notifyAdminsTaskCompleted,
} from "@/lib/telegram/task-notification-queue";
import { serializeTask } from "@/lib/tasks/serialize";

const taskInclude = {
  assignee: { select: { id: true, name: true, telegramId: true } },
  assignees: {
    include: { user: { select: { id: true, name: true, telegramId: true } } },
    orderBy: { createdAt: "asc" },
  },
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
  assigneeUserIds: z.array(z.string().uuid()).min(1).optional(),
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

  const existing = await prisma.task.findUnique({
    where: { id },
    include: { assignees: { include: { user: { select: { id: true } } } } },
  });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const adminEdit =
    parsed.data.title !== undefined ||
    parsed.data.description !== undefined ||
    parsed.data.assigneeUserIds !== undefined ||
    parsed.data.dueAt !== undefined ||
    parsed.data.scheduledAt !== undefined;
  if (adminEdit && session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const completing = parsed.data.status === "COMPLETED";
  const reopening = parsed.data.status === "OPEN";
  if (reopening && session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (completing && session.user.role !== "ADMIN") {
    const assigned =
      existing.assigneeUserId === session.user.id ||
      existing.assignees.some((assignee) => assignee.user.id === session.user.id);
    if (!assigned) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const assigneeUserIds = parsed.data.assigneeUserIds
    ? [...new Set(parsed.data.assigneeUserIds)]
    : undefined;
  if (assigneeUserIds) {
    const assignees = await prisma.user.findMany({
      where: { id: { in: assigneeUserIds }, isActive: true },
      select: { id: true },
    });
    if (assignees.length !== assigneeUserIds.length) {
      return NextResponse.json({ error: "Ответственный не найден" }, { status: 404 });
    }
  }

  const shouldRefreshNotification = !completing && existing.status === "OPEN" && adminEdit;
  if (shouldRefreshNotification) {
    await completeTaskNotification(id);
  }

  const task = await prisma.task.update({
    where: { id },
    data: {
      ...(parsed.data.title !== undefined ? { title: parsed.data.title } : {}),
      ...(parsed.data.description !== undefined
        ? { description: parsed.data.description || null }
        : {}),
      ...(assigneeUserIds !== undefined
        ? {
            assigneeUserId: assigneeUserIds[0],
            assignees: {
              deleteMany: {},
              create: assigneeUserIds.map((userId) => ({ userId })),
            },
          }
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
    await notifyAdminsTaskCompleted(task.id);
  } else if (reopening || shouldRefreshNotification) {
    await ensureTaskNotification(task.id);
  }

  const fresh = await prisma.task.findUniqueOrThrow({
    where: { id: task.id },
    include: taskInclude,
  });
  return NextResponse.json(serializeTask(fresh));
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.user.role !== "ADMIN") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  const existing = await prisma.task.findUnique({ where: { id }, select: { id: true } });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await completeTaskNotification(id);
  await prisma.task.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
