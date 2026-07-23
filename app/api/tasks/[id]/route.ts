import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db/prisma";
import {
  completeTaskNotification,
  ensureTaskNotification,
  notifyAdminsTaskCompleted,
  queueTaskNotificationReplacement,
} from "@/lib/telegram/task-notification-queue";
import { readTaskRequest, updateTaskSchema } from "@/lib/tasks/request";
import { serializeTask } from "@/lib/tasks/serialize";
import {
  MAX_TASK_FILES,
  removeTaskFiles,
  saveTaskFiles,
  validateTaskFiles,
} from "@/lib/tasks/storage";

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

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  let requestData;
  try {
    requestData = await readTaskRequest(req, updateTaskSchema);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Проверьте данные задачи" },
      { status: 400 },
    );
  }
  const { payload, files } = requestData;

  const existing = await prisma.task.findUnique({
    where: { id },
    include: {
      assignees: { include: { user: { select: { id: true } } } },
      attachments: true,
    },
  });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const keepAttachmentIds = payload.keepAttachmentIds
    ? new Set(payload.keepAttachmentIds)
    : null;
  const removedAttachments = keepAttachmentIds
    ? existing.attachments.filter((attachment) => !keepAttachmentIds.has(attachment.id))
    : [];
  const attachmentEdit = files.length > 0 || removedAttachments.length > 0;
  const detailsEdit =
    payload.title !== undefined ||
    payload.description !== undefined ||
    payload.assigneeUserIds !== undefined ||
    payload.dueAt !== undefined ||
    payload.scheduledAt !== undefined;
  const adminEdit = detailsEdit || attachmentEdit;
  if (adminEdit && session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const completing = payload.status === "COMPLETED";
  const reopening = payload.status === "OPEN";
  if (reopening && session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (completing && session.user.role !== "ADMIN") {
    const assigned =
      existing.assigneeUserId === session.user.id ||
      existing.assignees.some((assignee) => assignee.user.id === session.user.id);
    if (!assigned) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const assigneeUserIds = payload.assigneeUserIds
    ? [...new Set(payload.assigneeUserIds)]
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

  const keptAttachmentCount = existing.attachments.length - removedAttachments.length;
  if (keptAttachmentCount + files.length > MAX_TASK_FILES) {
    return NextResponse.json(
      { error: `Можно прикрепить не больше ${MAX_TASK_FILES} файлов` },
      { status: 400 },
    );
  }
  try {
    validateTaskFiles(files);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Проверьте выбранные файлы" },
      { status: 400 },
    );
  }

  const shouldRefreshNotification = !completing && existing.status === "OPEN" && detailsEdit;
  if (shouldRefreshNotification) {
    await queueTaskNotificationReplacement(id);
  }

  const savedFiles = await saveTaskFiles(files);
  let task;
  try {
    task = await prisma.task.update({
      where: { id },
      data: {
        ...(payload.title !== undefined ? { title: payload.title } : {}),
        ...(payload.description !== undefined
          ? { description: payload.description || null }
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
        ...(payload.dueAt !== undefined ? { dueAt: new Date(payload.dueAt) } : {}),
        ...(payload.scheduledAt !== undefined
          ? {
              scheduledAt: payload.scheduledAt
                ? new Date(payload.scheduledAt)
                : null,
            }
          : {}),
        ...(payload.status !== undefined ? { status: payload.status } : {}),
        ...(completing
          ? { completedAt: new Date(), completedByUserId: session.user.id }
          : {}),
        ...(reopening ? { completedAt: null, completedByUserId: null } : {}),
        ...(attachmentEdit
          ? {
              attachments: {
                deleteMany: { id: { in: removedAttachments.map((item) => item.id) } },
                create: savedFiles,
              },
            }
          : {}),
      },
      include: taskInclude,
    });
  } catch (error) {
    await removeTaskFiles(savedFiles.map((file) => file.storageKey));
    throw error;
  }
  await removeTaskFiles(removedAttachments.map((attachment) => attachment.storageKey));

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
  const existing = await prisma.task.findUnique({
    where: { id },
    include: { attachments: true },
  });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await completeTaskNotification(id);
  await prisma.task.delete({ where: { id } });
  await removeTaskFiles(existing.attachments.map((attachment) => attachment.storageKey));
  return NextResponse.json({ ok: true });
}
