import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  findUnique: vi.fn(),
  create: vi.fn(),
  prepareCredentials: vi.fn(),
  recordCredentialDelivery: vi.fn(),
  issueUserCredentials: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    user: {
      findUnique: mocks.findUnique,
      create: mocks.create,
    },
  },
}));
vi.mock("@/lib/users/credentials", () => ({
  prepareCredentials: mocks.prepareCredentials,
  recordCredentialDelivery: mocks.recordCredentialDelivery,
  issueUserCredentials: mocks.issueUserCredentials,
}));

import { POST as createUser } from "@/app/api/users/route";
import { POST as resetCredentials } from "@/app/api/users/[id]/credentials/route";

describe("user credential APIs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.mockResolvedValue({ user: { id: "admin", role: "ADMIN" } });
    mocks.findUnique.mockResolvedValue(null);
    mocks.prepareCredentials.mockResolvedValue({
      credentials: { login: "crm_123", password: "plain-password" },
      passwordHash: "bcrypt-hash",
    });
    mocks.create.mockResolvedValue({
      id: "user-1",
      name: "Сотрудник",
      login: "crm_123",
      telegramId: "123",
      credentialsDeliveredAt: null,
      credentialsDeliveryError: null,
      role: "MANAGER",
      isActive: true,
      createdAt: new Date(),
    });
    mocks.recordCredentialDelivery.mockResolvedValue({ sent: true, error: null });
  });

  it("creates Telegram and browser access on one user record", async () => {
    const response = await createUser(
      new NextRequest("http://localhost/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Сотрудник",
          telegramId: "123",
          role: "MANAGER",
        }),
      }),
    );

    expect(response.status).toBe(201);
    expect(mocks.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          telegramId: "123",
          login: "crm_123",
          passwordHash: "bcrypt-hash",
        }),
      }),
    );
    await expect(response.json()).resolves.toMatchObject({
      user: { id: "user-1", telegramId: "123", login: "crm_123" },
      credentials: { login: "crm_123", password: "plain-password" },
      delivery: { sent: true, error: null },
    });
  });

  it("allows only admins to reset credentials for an existing user", async () => {
    mocks.issueUserCredentials.mockResolvedValue({
      credentials: { login: "crm_123", password: "new-password" },
      delivery: { sent: false, error: "Forbidden" },
    });
    const response = await resetCredentials(new Request("http://localhost"), {
      params: Promise.resolve({ id: "user-1" }),
    });
    expect(response.status).toBe(200);
    expect(mocks.issueUserCredentials).toHaveBeenCalledWith("user-1");

    mocks.auth.mockResolvedValue({ user: { id: "manager", role: "MANAGER" } });
    const forbidden = await resetCredentials(new Request("http://localhost"), {
      params: Promise.resolve({ id: "user-1" }),
    });
    expect(forbidden.status).toBe(403);
  });
});
