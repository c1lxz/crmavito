import { prisma } from "@/lib/db/prisma";
import { sendNoteMentionNotification } from "@/lib/telegram/notify";

const PROCESSING_TIMEOUT_MS = 5 * 60_000;
const MAX_RETRY_DELAY_MS = 10 * 60_000;
const MAX_ATTEMPTS = 8;

function isPermanentTelegramError(message: string) {
  const normalized = message.toLowerCase();
  return (
    normalized.includes("chat not found") ||
    normalized.includes("bot was blocked") ||
    normalized.includes("user is deactivated")
  );
}

export function getNoteMentionRetryDelay(attempt: number) {
  return Math.min(15_000 * 2 ** Math.max(0, attempt - 1), MAX_RETRY_DELAY_MS);
}

async function claimMention(id: string) {
  const now = new Date();
  const claimed = await prisma.noteMention.updateMany({
    where: {
      id,
      status: { in: ["PENDING", "RETRY"] },
      nextAttemptAt: { lte: now },
    },
    data: { status: "PROCESSING", processingStartedAt: now },
  });
  if (claimed.count !== 1) return null;

  return prisma.noteMention.findUnique({
    where: { id },
    include: {
      user: { select: { name: true, telegramId: true, isActive: true } },
      note: {
        select: {
          title: true,
          createdBy: { select: { name: true } },
        },
      },
    },
  });
}

export async function processNoteMentionNotification(id: string): Promise<boolean> {
  const mention = await claimMention(id);
  if (!mention) return false;

  if (!mention.user.isActive || !mention.user.telegramId) {
    await prisma.noteMention.update({
      where: { id },
      data: {
        status: "FAILED",
        attempts: mention.attempts + 1,
        processingStartedAt: null,
        lastError: !mention.user.isActive
          ? "Сотрудник неактивен"
          : "У сотрудника не указан Telegram ID",
      },
    });
    return false;
  }

  try {
    await sendNoteMentionNotification({
      recipientTelegramId: mention.user.telegramId,
      noteTitle: mention.note.title,
      authorName: mention.note.createdBy.name,
    });
    await prisma.noteMention.update({
      where: { id },
      data: {
        status: "SENT",
        notifiedAt: new Date(),
        processingStartedAt: null,
        lastError: null,
      },
    });
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const attempts = mention.attempts + 1;
    const failed = isPermanentTelegramError(message) || attempts >= MAX_ATTEMPTS;
    await prisma.noteMention.update({
      where: { id },
      data: {
        status: failed ? "FAILED" : "RETRY",
        attempts,
        nextAttemptAt: new Date(Date.now() + getNoteMentionRetryDelay(attempts)),
        processingStartedAt: null,
        lastError: message.slice(0, 1000),
      },
    });
    return false;
  }
}

export async function processPendingNoteMentionNotifications(limit = 10): Promise<number> {
  const staleBefore = new Date(Date.now() - PROCESSING_TIMEOUT_MS);
  await prisma.noteMention.updateMany({
    where: {
      status: "PROCESSING",
      processingStartedAt: { lt: staleBefore },
    },
    data: {
      status: "RETRY",
      processingStartedAt: null,
      nextAttemptAt: new Date(),
      lastError: "Восстановлено после прерванной обработки",
    },
  });

  const pending = await prisma.noteMention.findMany({
    where: {
      status: { in: ["PENDING", "RETRY"] },
      nextAttemptAt: { lte: new Date() },
    },
    orderBy: { nextAttemptAt: "asc" },
    take: limit,
    select: { id: true },
  });

  let sent = 0;
  for (const mention of pending) {
    if (await processNoteMentionNotification(mention.id)) sent++;
  }
  return sent;
}
