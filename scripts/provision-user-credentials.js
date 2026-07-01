const fs = require("fs");
const path = require("path");
const { randomBytes } = require("crypto");
const { hash } = require("bcryptjs");

function loadEnv() {
  const envPath = path.join(process.cwd(), ".env");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)\s*$/);
    if (!match || process.env[match[1]]) continue;
    let value = match[2];
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[match[1]] = value;
  }
}

async function sendCredentials(telegramId, login, password) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return { sent: false, error: "TELEGRAM_BOT_TOKEN не настроен" };
  const appUrl = process.env.NEXTAUTH_URL || process.env.APP_URL;
  const text = [
    "Доступ к CRM Avito",
    "",
    `Логин: ${login}`,
    `Пароль: ${password}`,
    appUrl ? `Вход через браузер: ${appUrl.replace(/\/$/, "")}/login` : null,
    "",
    "Telegram и браузер используют одну и ту же учётную запись.",
  ]
    .filter((line) => line !== null)
    .join("\n");

  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: telegramId, text }),
      signal: AbortSignal.timeout(15_000),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || !body.ok) {
      return {
        sent: false,
        error: body.description || `Telegram HTTP ${response.status}`,
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

async function main() {
  loadEnv();
  const { PrismaClient } = require("@prisma/client");
  const prisma = new PrismaClient();

  try {
    const users = await prisma.user.findMany({
      where: {
        telegramId: { not: null },
        OR: [{ login: null }, { passwordHash: null }],
      },
      select: { id: true, name: true, telegramId: true },
      orderBy: { createdAt: "asc" },
    });

    let sent = 0;
    let failed = 0;
    for (const user of users) {
      const login = `crm_${user.telegramId}`;
      const password = randomBytes(18).toString("base64url");
      const passwordHash = await hash(password, 12);
      await prisma.user.update({
        where: { id: user.id },
        data: {
          login,
          passwordHash,
          credentialsDeliveredAt: null,
          credentialsDeliveryError: null,
        },
      });
      const delivery = await sendCredentials(user.telegramId, login, password);
      await prisma.user.update({
        where: { id: user.id },
        data: {
          credentialsDeliveredAt: delivery.sent ? new Date() : null,
          credentialsDeliveryError: delivery.error,
        },
      });

      if (delivery.sent) {
        sent += 1;
        console.log(`[credentials] ${user.name}: sent`);
      } else {
        failed += 1;
        console.error(
          `[credentials] ${user.name}: not sent — ${delivery.error || "unknown error"}`,
        );
      }
    }
    console.log(`[credentials] complete: users=${users.length}, sent=${sent}, failed=${failed}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error("[credentials] provisioning failed", error);
  process.exitCode = 1;
});
