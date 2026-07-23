import { NextRequest, NextResponse } from "next/server";
import { TaskStatus } from "@prisma/client";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db/prisma";
import { ensureTaskNotification } from "@/lib/telegram/task-notification-queue";
import { createTaskSchema, readTaskRequest } from "@/lib/tasks/request";
import { serializeTask } from "@/lib/tasks/serialize";
import { removeTaskFiles } from "@/lib/tasks/storage";

const taskInclude = {
  assignee: { select: { id: true, name: true, telegramId: true } },
  assignees: {
    include: { user: { select: { id: true, name: true, telegramId: true } } },
    orderBy: { createdAt: "asc" },
  },
  createdBy: { select: { id: true, name: true } },
  completedBy: { select: { id: true, name: true } },
  attachments: { orderBy: { createdAt: "asc" } },
  notification: {
    select: {
      status: true,
      sentAt: true,
      lastError: true,
      telegramMessageId: true,
    },
  },
} as const;

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

  try {
    const { payload, files } = await readTaskRequest(req, createTaskSchema);
    const assigneeUserIds = [...new Set(payload.assigneeUserIds)];
    const assignees = await prisma.user.findMany({
      where: { id: { in: assigneeUserIds }, isActive: true },
      select: { id: true },
    });
    if (assignees.length !== assigneeUserIds.length) {
      await removeTaskFiles(files.map((file) => file.storageKey));
      return NextResponse.json({ error: "Ответственный не найден" }, { status: 404 });
    }

    let task;
    try {
      task = await prisma.task.create({
        data: {
          title: payload.title,
          description: payload.description || null,
          assigneeUserId: assigneeUserIds[0],
          createdByUserId: session.user.id,
          dueAt: new Date(payload.dueAt),
          scheduledAt: payload.scheduledAt ? new Date(payload.scheduledAt) : null,
          assignees: {
            create: assigneeUserIds.map((userId) => ({ userId })),
          },
          attachments: { create: files },
        },
        include: taskInclude,
      });
    } catch (error) {
      await removeTaskFiles(files.map((file) => file.storageKey));
      throw error;
    }

    await ensureTaskNotification(task.id);
    return NextResponse.json(serializeTask(task), { status: 201 });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Не удалось создать задачу",
      },
      { status: 400 },
    );
  }
}
