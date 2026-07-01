import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  processPendingOrderNotifications: vi.fn(),
}));

vi.mock("@/lib/telegram/order-notification-queue", () => ({
  processPendingOrderNotifications: mocks.processPendingOrderNotifications,
}));

import { POST } from "@/app/api/internal/telegram-notifications/route";

describe("Telegram queue worker endpoint", () => {
  afterEach(() => {
    delete process.env.TELEGRAM_QUEUE_SECRET;
    vi.clearAllMocks();
  });

  it("rejects requests without the worker secret", async () => {
    process.env.TELEGRAM_QUEUE_SECRET = "secret";
    const response = await POST(
      new Request("http://localhost/api/internal/telegram-notifications", {
        method: "POST",
      })
    );
    expect(response.status).toBe(401);
    expect(mocks.processPendingOrderNotifications).not.toHaveBeenCalled();
  });

  it("processes pending notifications for an authenticated local worker", async () => {
    process.env.TELEGRAM_QUEUE_SECRET = "secret";
    mocks.processPendingOrderNotifications.mockResolvedValue(2);
    const response = await POST(
      new Request("http://localhost/api/internal/telegram-notifications", {
        method: "POST",
        headers: { "x-worker-secret": "secret" },
      })
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ sent: 2 });
  });
});
