import { beforeEach, describe, expect, it, vi } from "vitest";
import { compare, hash } from "bcryptjs";

const mocks = vi.hoisted(() => ({
  findFirst: vi.fn(),
  findUnique: vi.fn(),
  update: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    user: {
      findFirst: mocks.findFirst,
      findUnique: mocks.findUnique,
      update: mocks.update,
    },
  },
}));

import { authenticateWithPassword } from "@/lib/auth/password-login";
import {
  buildUserLogin,
  generatePassword,
  prepareCredentials,
  issueUserCredentials,
  sendUserCredentials,
} from "@/lib/users/credentials";

describe("browser credentials", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    process.env.TELEGRAM_BOT_TOKEN = "test-token";
  });

  it("generates a stable login from Telegram ID and a strong random password", async () => {
    expect(buildUserLogin("123456789")).toBe("crm_123456789");
    const first = generatePassword();
    const second = generatePassword();
    expect(first.length).toBeGreaterThanOrEqual(20);
    expect(second).not.toBe(first);

    const prepared = await prepareCredentials("123456789");
    expect(prepared.credentials.login).toBe("crm_123456789");
    await expect(compare(prepared.credentials.password, prepared.passwordHash)).resolves.toBe(true);
  });

  it("authenticates login and password against the same user row", async () => {
    const passwordHash = await hash("correct-password", 4);
    const user = {
      id: "user-1",
      name: "Сотрудник",
      login: "crm_123",
      email: null,
      passwordHash,
      telegramId: "123",
      role: "MANAGER",
      isActive: true,
      createdAt: new Date(),
    };
    mocks.findFirst.mockResolvedValue(user);

    await expect(authenticateWithPassword(" CRM_123 ", "correct-password")).resolves.toEqual(user);
    await expect(authenticateWithPassword("crm_123", "wrong-password")).resolves.toBeNull();
    expect(mocks.findFirst).toHaveBeenCalledWith({
      where: {
        isActive: true,
        OR: [
          { login: "crm_123" },
          { email: { equals: "crm_123", mode: "insensitive" } },
        ],
      },
    });
  });

  it("sends credentials directly to the employee Telegram chat", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      sendUserCredentials("123", { login: "crm_123", password: "secret" }),
    ).resolves.toEqual({ sent: true, error: null });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.telegram.org/bottest-token/sendMessage",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining('"chat_id":"123"'),
      }),
    );
    expect(fetchMock.mock.calls[0][1].body).toContain("crm_123");
    expect(fetchMock.mock.calls[0][1].body).toContain("secret");
  });

  it("reports Telegram refusal without losing the generated browser credentials", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      json: async () => ({ ok: false, description: "Forbidden: bot can't initiate conversation" }),
    }));

    await expect(
      sendUserCredentials("123", { login: "crm_123", password: "secret" }),
    ).resolves.toEqual({
      sent: false,
      error: "Forbidden: bot can't initiate conversation",
    });
  });

  it("issues browser credentials on the existing Telegram-linked user row", async () => {
    mocks.findUnique.mockResolvedValue({ id: "user-1", telegramId: "123" });
    mocks.update.mockResolvedValue({});
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true }),
    }));

    const result = await issueUserCredentials("user-1");

    expect(result.credentials.login).toBe("crm_123");
    expect(result.delivery.sent).toBe(true);
    expect(mocks.update).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: { id: "user-1" },
        data: expect.objectContaining({
          login: "crm_123",
          passwordHash: expect.any(String),
        }),
      }),
    );
  });
});
