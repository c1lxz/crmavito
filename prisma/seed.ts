import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const telegramAdmins = [
  { telegramId: "1247326625", name: "Admin 1" },
  { telegramId: "5039428987", name: "Admin 2" },
];

async function clearBusinessData() {
  await prisma.$transaction([
    prisma.return.deleteMany(),
    prisma.auditLog.deleteMany(),
    prisma.expense.deleteMany(),
    prisma.order.deleteMany(),
    prisma.product.deleteMany(),
    prisma.counterparty.deleteMany(),
    prisma.user.deleteMany(),
  ]);
}

async function seedTelegramAdmins() {
  for (const admin of telegramAdmins) {
    await prisma.user.upsert({
      where: { telegramId: admin.telegramId },
      update: { name: admin.name, role: "ADMIN", isActive: true },
      create: {
        name: admin.name,
        telegramId: admin.telegramId,
        role: "ADMIN",
        isActive: true,
      },
    });

    console.log(`Telegram admin ready: ${admin.telegramId}`);
  }
}

async function main() {
  console.log("Cleaning database...");
  await clearBusinessData();

  console.log("Seeding required access users...");
  await seedTelegramAdmins();

  console.log("Seed completed without demo data.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
