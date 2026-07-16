import { NextRequest, NextResponse } from "next/server";
import { TaskStatus } from "@prisma/client";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db/prisma";
import { ensureTaskNotification } from "@/lib/telegram/task-notification-queue";
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

const createSchema = z.object({
  title: z.string().trim().min(2),
  description: z.string().trim().optional(),
  assigneeUserIds: z.array(z.string().uuid()).min(1),
  dueAt: z.string().datetime(),
  scheduledAt: z.string().datetime().nullable().optional(),
});

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status");
  const assigneeUserId = searchParams.get("assigneeUserId");

  const tasks = await prisma.task.findMany({
    where: {
      ...(status && status in TaskStatus ? { status: status as TaskStatus } : {}),
      ...(assigneeUserId
        ? {
            OR: [
              { assigneeUserId },
              { assignees: { some: { userId: assigneeUserId } } },
            ],
          }
        : {}),
    },
    include: taskInclude,
    orderBy: [{ status: "asc" }, { dueAt: "asc" }],
  });

  return NextResponse.json({ tasks: tasks.map(serializeTask) });
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.user.role !== "ADMIN") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const parsed = createSchema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const assigneeUserIds = [...new Set(parsed.data.assigneeUserIds)];
  const assignees = await prisma.user.findMany({
    where: { id: { in: assigneeUserIds }, isActive: true },
    select: { id: true },
  });
  if (assignees.length !== assigneeUserIds.length) {
    return NextResponse.json({ error: "Ответственный не найден" }, { status: 404 });
  }

  const task = await prisma.task.create({
    data: {
      title: parsed.data.title,
      description: parsed.data.description || null,
      assigneeUserId: assigneeUserIds[0],
      createdByUserId: session.user.id,
      dueAt: new Date(parsed.data.dueAt),
      scheduledAt: parsed.data.scheduledAt ? new Date(parsed.data.scheduledAt) : null,
      assignees: {
        create: assigneeUserIds.map((userId) => ({ userId })),
      },
    },
    include: taskInclude,
  });

  await ensureTaskNotification(task.id);

  return NextResponse.json(serializeTask(task), { status: 201 });
}
