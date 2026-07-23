import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  sendNoteMentionNotification: vi.fn(),
  prisma: {
    noteMention: {
      updateMany: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
    },
  },
}));

vi.mock("@/lib/db/prisma", () => ({ prisma: mocks.prisma }));
vi.mock("@/lib/telegram/notify", () => ({
  sendNoteMentionNotification: mocks.sendNoteMentionNotification,
}));

import {
  getNoteMentionRetryDelay,
  processNoteMentionNotification,
} from "@/lib/telegram/note-mention-notification-queue";

const claimedMention = {
  id: "mention-1",
  attempts: 0,
  user: {
    name: "Анна",
    telegramId: "123456",
    isActive: true,
  },
  note: {
    title: "Условия поставщика",
    createdBy: { name: "Администратор" },
  },
};

describe("note mention Telegram queue", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.prisma.noteMention.updateMany.mockResolvedValue({ count: 1 });
    mocks.prisma.noteMention.findUnique.mockResolvedValue(claimedMention);
    mocks.prisma.noteMention.update.mockResolvedValue({});
  });

  it("sends a personal notification and marks it delivered", async () => {
    await expect(processNoteMentionNotification("mention-1")).resolves.toBe(true);

    expect(mocks.sendNoteMentionNotification).toHaveBeenCalledWith({
      recipientTelegramId: "123456",
      noteTitle: "Условия поставщика",
      authorName: "Администратор",
    });
    expect(mocks.prisma.noteMention.update).toHaveBeenLastCalledWith({
      where: { id: "mention-1" },
      data: expect.objectContaining({
        status: "SENT",
        notifiedAt: expect.any(Date),
        lastError: null,
      }),
    });
  });

  it("retries temporary Telegram errors", async () => {
    mocks.sendNoteMentionNotification.mockRejectedValue(new Error("Telegram HTTP 500"));

    await expect(processNoteMentionNotification("mention-1")).resolves.toBe(false);

    expect(mocks.prisma.noteMention.update).toHaveBeenLastCalledWith({
      where: { id: "mention-1" },
      data: expect.objectContaining({
        status: "RETRY",
        attempts: 1,
        nextAttemptAt: expect.any(Date),
        lastError: "Telegram HTTP 500",
      }),
    });
  });

  it("does not retry an employee without Telegram ID", async () => {
    mocks.prisma.noteMention.findUnique.mockResolvedValue({
      ...claimedMention,
      user: { ...claimedMention.user, telegramId: null },
    });

    await expect(processNoteMentionNotification("mention-1")).resolves.toBe(false);
    expect(mocks.sendNoteMentionNotification).not.toHaveBeenCalled();
    expect(mocks.prisma.noteMention.update).toHaveBeenLastCalledWith({
      where: { id: "mention-1" },
      data: expect.objectContaining({
        status: "FAILED",
        lastError: "У сотрудника не указан Telegram ID",
      }),
    });
  });

  it("uses capped exponential backoff", () => {
    expect(getNoteMentionRetryDelay(1)).toBe(15_000);
    expect(getNoteMentionRetryDelay(2)).toBe(30_000);
    expect(getNoteMentionRetryDelay(20)).toBe(10 * 60_000);
  });
});
