import "dotenv/config";
import { prisma } from "../lib/db/prisma";
import { processPendingOrderNotifications } from "../lib/telegram/order-notification-queue";

const POLL_INTERVAL_MS = 5_000;
let stopping = false;
let processing = false;

async function tick() {
  if (stopping || processing) return;
  processing = true;
  try {
    const sent = await processPendingOrderNotifications();
    if (sent > 0) console.log(`[telegram-queue] sent ${sent} notification(s)`);
  } catch (error) {
    console.error("[telegram-queue] worker tick failed", error);
  } finally {
    processing = false;
  }
}

async function shutdown() {
  stopping = true;
  while (processing) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  await prisma.$disconnect();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

console.log(`[telegram-queue] worker started, poll interval ${POLL_INTERVAL_MS}ms`);
void tick();
setInterval(() => void tick(), POLL_INTERVAL_MS);
