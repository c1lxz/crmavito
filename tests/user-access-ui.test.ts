import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function source(file: string): string {
  return readFileSync(path.resolve(__dirname, "..", file), "utf8");
}

describe("unified Telegram and browser user access", () => {
  it("stores login and delivery state on the same User model", () => {
    const schema = source("prisma/schema.prisma");
    expect(schema).toContain("login        String?   @unique");
    expect(schema).toContain("passwordHash String?");
    expect(schema).toContain("telegramId   String?   @unique");
    expect(schema).toContain("credentialsDeliveredAt");
    expect(schema).toContain("credentialsDeliveryError");
  });

  it("uses login instead of requiring email on the browser sign-in screen", () => {
    const loginPage = source("app/(auth)/login/page.tsx");
    expect(loginPage).toContain('name="login"');
    expect(loginPage).toContain('autoComplete="username"');
    expect(loginPage).not.toContain('name="email"');
  });

  it("shows generated credentials once and supports issuing a new password", () => {
    const settings = source("components/settings/settings-client.tsx");
    expect(settings).toContain("Пароль показывается только сейчас");
    expect(settings).toContain("/credentials");
    expect(settings).toContain("Выдать новый пароль");
    expect(settings).toContain("Реквизиты отправлены сотруднику в Telegram");
  });

  it("includes a one-time provisioning script for existing users", () => {
    const script = source("scripts/provision-user-credentials.js");
    expect(script).toContain("randomBytes");
    expect(script).toContain("login: null");
    expect(script).not.toContain("console.log(password");
  });
});
