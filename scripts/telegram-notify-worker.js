const fs = require("fs");
const path = require("path");

const POLL_INTERVAL_MS = 5_000;
let processing = false;

function loadEnv() {
  const envPath = path.join(process.cwd(), ".env");
  if (!fs.existsSync(envPath)) return;

  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const line of lines) {
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

function getWorkerSecret() {
  return (
    process.env.TELEGRAM_QUEUE_SECRET ||
    process.env.CRON_SECRET ||
    process.env.TELEGRAM_BOT_TOKEN
  );
}

async function tick() {
  if (processing) return;
  const secret = getWorkerSecret();
  if (!secret) {
    console.error("[telegram-queue] worker secret is not configured");
    return;
  }

  processing = true;
  try {
    const response = await fetch(
      "http://127.0.0.1:3000/api/internal/telegram-notifications",
      {
        method: "POST",
        headers: { "x-worker-secret": secret },
        signal: AbortSignal.timeout(20_000),
      }
    );
    const body = await response.text();
    if (!response.ok) {
      console.error(`[telegram-queue] poll failed: ${response.status} ${body.slice(0, 500)}`);
      return;
    }
    const result = JSON.parse(body);
    if (result.sent > 0) {
      console.log(`[telegram-queue] sent ${result.sent} notification(s)`);
    }
  } catch (error) {
    console.error("[telegram-queue] poll error", error);
  } finally {
    processing = false;
  }
}

loadEnv();
console.log(`[telegram-queue] worker started, poll interval ${POLL_INTERVAL_MS}ms`);
void tick();
setInterval(() => void tick(), POLL_INTERVAL_MS);
