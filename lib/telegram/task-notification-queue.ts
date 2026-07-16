import { prisma } from "@/lib/db/prisma";
import {
  answerTelegramCallback,
  deleteTaskNotificationMessage,
  sendTaskCompletedToAdmin,
  sendTaskNotification,
} from "@/lib/telegram/notify";

const PROCESSING_TIMEOUT_MS = 5 * 60_000;
const MAX_RETRY_DELAY_MS = 10 * 60_000;

export function getTaskNotificationRetryDelay(attempt: number): number {
  return Math.min(15_000 * 2 ** Math.max(0, attempt - 1), MAX_RETRY_DELAY_MS);
}

export async function ensureTaskNotification(taskId: string): Promise<void> {
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: { id: true, status: true, scheduledAt: true, assigneeUserId: true },
  });
  if (!task || task.status === "COMPLETED") return;

  const assignmentCount = await prisma.taskAssignee.count({ where: { taskId } });
  if (assignmentCount === 0) {
    await prisma.taskAssignee.create({
      data: { taskId, userId: task.assigneeUserId },
    });
  }

  await prisma.taskNotification.upsert({
    where: { taskId },
    create: {
      taskId,
      nextAttemptAt: task.scheduledAt ?? new Date(),
    },
    update: {
      status: "PENDING",
      nextAttemptAt: task.scheduledAt ?? new Date(),
      processingStartedAt: null,
      lastError: null,
    },
  });
}

export async function queueTaskNotificationReplacement(taskId: string): Promise<void> {
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: { id: true, status: true, scheduledAt: true, assigneeUserId: true },
  });
  if (!task || task.status === "COMPLETED") return;

  const assignments = await prisma.taskAssignee.findMany({
    where: { taskId },
    select: { telegramChatId: true, telegramMessageId: true },
  });
  const cleanupRows = assignments
    .filter((assignment) => assignment.telegramChatId && assignment.telegramMessageId)
    .map((assignment) => ({
      taskId,
      telegramChatId: assignment.telegramChatId!,
      telegramMessageId: assignment.telegramMessageId!,
    }));

  if (cleanupRows.length > 0) {
    await prisma.taskNotificationCleanup.createMany({
      data: cleanupRows,
      skipDuplicates: true,
    });
  }

  await prisma.taskAssignee.updateMany({
    where: { taskId },
    data: {
      notificationStatus: "PENDING",
      attempts: 0,
      lastError: null,
      notifiedAt: null,
      telegramChatId: null,
      telegramMessageId: null,
    },
  });

  await prisma.taskNotification.upsert({
    where: { taskId },
    create: {
      taskId,
      nextAttemptAt: task.scheduledAt ?? new Date(),
    },
    update: {
      status: "PENDING",
      attempts: 0,
      nextAttemptAt: task.scheduledAt ?? new Date(),
      processingStartedAt: null,
      lastError: null,
    },
  });
}

async function claimTaskNotification(notificationId: string) {
  const now = new Date();
  const claimed = await prisma.taskNotification.updateMany({
    where: {
      id: notificationId,
      status: { in: ["PENDING", "RETRY"] },
      nextAttemptAt: { lte: now },
    },
    data: {
      status: "PROCESSING",
      processingStartedAt: now,
    },
  });
  if (claimed.count !== 1) return null;
  return prisma.taskNotification.findUnique({
    where: { id: notificationId },
    include: {
      task: {
        include: {
          createdBy: { select: { name: true } },
          assignees: {
            include: { user: { select: { id: true, name: true, telegramId: true } } },
            orderBy: { createdAt: "asc" },
          },
        },
      },
    },
  });
}

export async function processTaskNotification(notificationId: string): Promise<boolean> {
  const notification = await claimTaskNotification(notificationId);
  if (!notification) return false;

  if (notification.task.status === "COMPLETED") {
    await prisma.taskNotification.update({
      where: { id: notification.id },
      data: { status: "COMPLETED", processingStartedAt: null },
    });
    return false;
  }

  try {
    let sentCount = 0;
    const errors: string[] = [];
    const assignments =
      notification.task.assignees.length > 0
        ? notification.task.assignees
        : await prisma.taskAssignee.create({
            data: {
              taskId: notification.taskId,
              userId: notification.task.assigneeUserId,
            },
            include: { user: { select: { id: true, name: true, telegramId: true } } },
          }).then((assignment) => [assignment]);

    for (const assignment of assignments) {
      if (assignment.notificationStatus === "SENT") continue;
      if (!assignment.user.telegramId) {
        await prisma.taskAssignee.update({
          where: { id: assignment.id },
          data: {
            notificationStatus: "RETRY",
            attempts: assignment.attempts + 1,
            lastError: "У ответственного не указан Telegram ID",
          },
        });
        errors.push(`У ${assignment.user.name} не указан Telegram ID`);
        continue;
      }

      const sent = await sendTaskNotification({
        taskId: notification.taskId,
        title: notification.task.title,
        description: notification.task.description,
        dueAt: notification.task.dueAt,
        assigneeTelegramId: assignment.user.telegramId,
      });

      await prisma.taskAssignee.update({
        where: { id: assignment.id },
        data: {
          notificationStatus: "SENT",
          notifiedAt: new Date(),
          telegramChatId: sent.chatId,
          telegramMessageId: sent.messageId,
          lastError: null,
        },
      });
      sentCount++;
    }

    if (errors.length > 0) {
      throw new Error(errors.join("; "));
    }

    await deleteQueuedTaskNotificationMessages(notification.taskId);

    await prisma.taskNotification.update({
      where: { id: notification.id },
      data: {
        status: "SENT",
        sentAt: new Date(),
        lastError: null,
        processingStartedAt: null,
      },
    });
    return sentCount > 0;
  } catch (error) {
    const attempts = notification.attempts + 1;
    const message = error instanceof Error ? error.message : String(error);
    console.error(
      `[telegram-queue] task ${notification.taskId}, attempt ${attempts}: ${message}`
    );
    await prisma.taskNotification.update({
      where: { id: notification.id },
      data: {
        status: "RETRY",
        attempts,
        nextAttemptAt: new Date(Date.now() + getTaskNotificationRetryDelay(attempts)),
        lastError: message.slice(0, 1000),
        processingStartedAt: null,
      },
    });
    return false;
  }
}

async function deleteQueuedTaskNotificationMessages(taskId: string): Promise<void> {
  const cleanupRows = await prisma.taskNotificationCleanup.findMany({
    where: { taskId },
    select: { id: true, telegramChatId: true, telegramMessageId: true },
  });

  for (const cleanup of cleanupRows) {
    await deleteTaskNotificationMessage(
      cleanup.telegramChatId,
      cleanup.telegramMessageId
    ).catch((error) => {
      console.error(
        `[telegram-queue] task ${taskId} old notification delete failed: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    });
  }

  if (cleanupRows.length > 0) {
    await prisma.taskNotificationCleanup.deleteMany({ where: { taskId } });
  }
}

export async function completeTaskNotification(taskId: string): Promise<void> {
  const assignments = await prisma.taskAssignee.findMany({
    where: { taskId },
    select: { id: true, telegramChatId: true, telegramMessageId: true },
  });

  for (const assignment of assignments) {
    if (!assignment.telegramChatId || !assignment.telegramMessageId) continue;
    await deleteTaskNotificationMessage(
      assignment.telegramChatId,
      assignment.telegramMessageId
    ).catch((error) => {
      console.error(
        `[telegram-queue] task ${taskId} delete failed: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    });
  }

  await prisma.taskAssignee.updateMany({
    where: { taskId },
    data: { notificationStatus: "COMPLETED", lastError: null },
  });

  await prisma.taskNotificationCleanup.deleteMany({ where: { taskId } });

  await prisma.taskNotification.updateMany({
    where: { taskId },
    data: {
      status: "COMPLETED",
      processingStartedAt: null,
      lastError: null,
    },
  });
}

export async function notifyAdminsTaskCompleted(taskId: string): Promise<void> {
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    include: {
      assignee: { select: { name: true } },
      assignees: { include: { user: { select: { name: true } } }, orderBy: { createdAt: "asc" } },
      completedBy: { select: { name: true } },
    },
  });
  if (!task?.completedAt) return;

  const admins = await prisma.user.findMany({
    where: { role: "ADMIN", isActive: true, telegramId: { not: null } },
    select: { telegramId: true },
  });
  const assigneeNames = task.assignees.length > 0
    ? task.assignees.map((assignee) => assignee.user.name)
    : [task.assignee.name];

  await Promise.all(
    admins.map((admin) =>
      admin.telegramId
        ? sendTaskCompletedToAdmin({
            adminTelegramId: admin.telegramId,
            title: task.title,
            description: task.description,
            dueAt: task.dueAt,
            completedAt: task.completedAt!,
            assigneeNames,
            completedByName: task.completedBy?.name ?? null,
          }).catch((error) => {
            console.error(
              `[telegram-queue] task ${taskId} admin notify failed: ${
                error instanceof Error ? error.message : String(error)
              }`
            );
          })
        : Promise.resolve(),
    ),
  );
}

export async function completeTaskFromTelegram(options: {
  taskId: string;
  telegramId: string;
  callbackQueryId?: string;
}): Promise<{ ok: boolean; message: string }> {
  const task = await prisma.task.findUnique({
    where: { id: options.taskId },
    include: {
      assignees: {
        include: { user: { select: { id: true, telegramId: true } } },
      },
    },
  });

  if (!task) return { ok: false, message: "Задача не найдена" };
  if (task.status === "COMPLETED") return { ok: true, message: "Задача уже выполнена" };

  const assignment = task.assignees.find(
    (item) => item.user.telegramId === options.telegramId,
  );
  const legacyAssignee = assignment
    ? null
    : await prisma.user.findFirst({
        where: { id: task.assigneeUserId, telegramId: options.telegramId },
        select: { id: true },
      });
  const completedByUserId = assignment?.user.id ?? legacyAssignee?.id;
  if (!completedByUserId) return { ok: false, message: "Эта задача назначена не вам" };

  const completedAt = new Date();
  await prisma.task.update({
    where: { id: task.id },
    data: {
      status: "COMPLETED",
      completedAt,
      completedByUserId,
    },
  });
  await completeTaskNotification(task.id);
  await notifyAdminsTaskCompleted(task.id);
  if (options.callbackQueryId) {
    await answerTelegramCallback(options.callbackQueryId, "Готово").catch(() => null);
  }
  return { ok: true, message: "Задача выполнена" };
}

export async function processPendingTaskNotifications(limit = 10): Promise<number> {
  const now = new Date();
  await prisma.taskNotification.updateMany({
    where: {
      status: "PROCESSING",
      processingStartedAt: {
        lt: new Date(now.getTime() - PROCESSING_TIMEOUT_MS),
      },
    },
    data: {
      status: "RETRY",
      nextAttemptAt: now,
      processingStartedAt: null,
      lastError: "Повтор после прерванной обработки",
    },
  });

  const pending = await prisma.taskNotification.findMany({
    where: {
      status: { in: ["PENDING", "RETRY"] },
      nextAttemptAt: { lte: now },
    },
    orderBy: { createdAt: "asc" },
    take: limit,
    select: { id: true },
  });

  let sent = 0;
  for (const notification of pending) {
    if (await processTaskNotification(notification.id)) sent++;
  }
  return sent;
}
