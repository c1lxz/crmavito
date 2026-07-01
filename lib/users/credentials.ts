import { randomBytes } from "node:crypto";
import { hash } from "bcryptjs";
import { prisma } from "@/lib/db/prisma";

export interface PlainCredentials {
  login: string;
  password: string;
}

export interface CredentialDelivery {
  sent: boolean;
  error: string | null;
}

export function buildUserLogin(telegramId: string): string {
  return `crm_${telegramId}`;
}

export function generatePassword(): string {
  return randomBytes(18).toString("base64url");
}

export async function prepareCredentials(telegramId: string): Promise<{
  credentials: PlainCredentials;
  passwordHash: string;
}> {
  const credentials = {
    login: buildUserLogin(telegramId),
    password: generatePassword(),
  };
  return {
    credentials,
    passwordHash: await hash(credentials.password, 12),
  };
}

export async function sendUserCredentials(
  telegramId: string,
  credentials: PlainCredentials,
): Promise<CredentialDelivery> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    return { sent: false, error: "TELEGRAM_BOT_TOKEN не настроен" };
  }

  const appUrl = process.env.NEXTAUTH_URL ?? process.env.APP_URL;
  const text = [
    "Доступ к CRM Avito",
    "",
    `Логин: ${credentials.login}`,
    `Пароль: ${credentials.password}`,
    appUrl ? `Вход через браузер: ${appUrl.replace(/\/$/, "")}/login` : null,
    "",
    "Telegram и браузер используют одну и ту же учётную запись.",
  ]
    .filter((line): line is string => line !== null)
    .join("\n");

  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: telegramId, text }),
      signal: AbortSignal.timeout(15_000),
    });
    const body = (await response.json().catch(() => ({}))) as {
      ok?: boolean;
      description?: string;
    };
    if (!response.ok || !body.ok) {
      return {
        sent: false,
        error: body.description ?? `Telegram HTTP ${response.status}`,
      };
    }
    return { sent: true, error: null };
  } catch (error) {
    return {
      sent: false,
      error: error instanceof Error ? error.message : "Ошибка отправки в Telegram",
    };
  }
}

export async function recordCredentialDelivery(
  userId: string,
  telegramId: string,
  credentials: PlainCredentials,
): Promise<CredentialDelivery> {
  const delivery = await sendUserCredentials(telegramId, credentials);
  await prisma.user.update({
    where: { id: userId },
    data: {
      credentialsDeliveredAt: delivery.sent ? new Date() : null,
      credentialsDeliveryError: delivery.error,
    },
  });
  return delivery;
}

export async function issueUserCredentials(userId: string): Promise<{
  credentials: PlainCredentials;
  delivery: CredentialDelivery;
}> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, telegramId: true },
  });
  if (!user) throw new Error("Пользователь не найден");
  if (!user.telegramId) throw new Error("У пользователя не указан Telegram ID");

  const prepared = await prepareCredentials(user.telegramId);
  await prisma.user.update({
    where: { id: user.id },
    data: {
      login: prepared.credentials.login,
      passwordHash: prepared.passwordHash,
      credentialsDeliveredAt: null,
      credentialsDeliveryError: null,
    },
  });
  const delivery = await recordCredentialDelivery(
    user.id,
    user.telegramId,
    prepared.credentials,
  );
  return { credentials: prepared.credentials, delivery };
}
