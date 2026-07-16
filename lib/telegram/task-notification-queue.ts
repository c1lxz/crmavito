import { prisma } from "@/lib/db/prisma";
import {
  deleteTaskNotificationMessage,
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
    select: { id: true, status: true, scheduledAt: true },
  });
  if (!task || task.status === "COMPLETED") return;

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
          assignee: { select: { name: true, telegramId: true } },
          createdBy: { select: { name: true } },
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
    if (!notification.task.assignee.telegramId) {
      throw new Error("У ответственного не указан Telegram ID");
    }

    const sent = await sendTaskNotification({
      title: notification.task.title,
      description: notification.task.description,
      dueAt: notification.task.dueAt,
      scheduledAt: notification.task.scheduledAt,
      assigneeTelegramId: notification.task.assignee.telegramId,
      assigneeName: notification.task.assignee.name,
      createdByName: notification.task.createdBy.name,
    });

    await prisma.taskNotification.update({
      where: { id: notification.id },
      data: {
        status: "SENT",
        sentAt: new Date(),
        telegramChatId: sent.chatId,
        telegramMessageId: sent.messageId,
        lastError: null,
        processingStartedAt: null,
      },
    });
    return true;
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

export async function completeTaskNotification(taskId: string): Promise<void> {
  const notification = await prisma.taskNotification.findUnique({ where: { taskId } });
  if (!notification) return;

  if (notification.telegramChatId && notification.telegramMessageId) {
    await deleteTaskNotificationMessage(
      notification.telegramChatId,
      notification.telegramMessageId
    ).catch((error) => {
      console.error(
        `[telegram-queue] task ${taskId} delete failed: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    });
  }

  await prisma.taskNotification.update({
    where: { id: notification.id },
    data: {
      status: "COMPLETED",
      processingStartedAt: null,
      lastError: null,
    },
  });
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
