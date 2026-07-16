import { NextRequest, NextResponse } from "next/server";
import { TaskStatus } from "@prisma/client";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db/prisma";
import { ensureTaskNotification } from "@/lib/telegram/task-notification-queue";
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

const createSchema = z.object({
  title: z.string().trim().min(2),
  description: z.string().trim().optional(),
  assigneeUserId: z.string().uuid(),
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
      ...(assigneeUserId ? { assigneeUserId } : {}),
    },
    include: taskInclude,
    orderBy: [{ status: "asc" }, { dueAt: "asc" }],
  });

  return NextResponse.json({ tasks: tasks.map(serializeTask) });
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = createSchema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const assignee = await prisma.user.findFirst({
    where: { id: parsed.data.assigneeUserId, isActive: true },
    select: { id: true },
  });
  if (!assignee) {
    return NextResponse.json({ error: "Ответственный не найден" }, { status: 404 });
  }

  const task = await prisma.task.create({
    data: {
      title: parsed.data.title,
      description: parsed.data.description || null,
      assigneeUserId: parsed.data.assigneeUserId,
      createdByUserId: session.user.id,
      dueAt: new Date(parsed.data.dueAt),
      scheduledAt: parsed.data.scheduledAt ? new Date(parsed.data.scheduledAt) : null,
    },
    include: taskInclude,
  });

  await ensureTaskNotification(task.id);

  return NextResponse.json(serializeTask(task), { status: 201 });
}
