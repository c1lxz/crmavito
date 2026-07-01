import fs from "node:fs";
import path from "node:path";
import { prisma } from "../lib/db/prisma";
import { issueUserCredentials } from "../lib/users/credentials";

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

async function main() {
  loadEnv();
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
    const result = await issueUserCredentials(user.id);
    if (result.delivery.sent) {
      sent += 1;
      console.log(`[credentials] ${user.name}: sent`);
    } else {
      failed += 1;
      console.error(
        `[credentials] ${user.name}: not sent — ${result.delivery.error ?? "unknown error"}`,
      );
    }
  }

  console.log(`[credentials] complete: users=${users.length}, sent=${sent}, failed=${failed}`);
}

main()
  .catch((error) => {
    console.error("[credentials] provisioning failed", error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
