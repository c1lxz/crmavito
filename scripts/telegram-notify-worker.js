const fs = require("fs");
const path = require("path");

const POLL_INTERVAL_MS = 5_000;
let processing = false;
let updatesProcessing = false;
let updateOffset = 0;

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

async function processTelegramUpdates() {
  if (updatesProcessing) return;
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const secret = getWorkerSecret();
  if (!token || !secret) return;

  updatesProcessing = true;
  try {
    const params = new URLSearchParams({
      timeout: "0",
      allowed_updates: JSON.stringify(["callback_query"]),
    });
    if (updateOffset > 0) params.set("offset", String(updateOffset));

    const response = await fetch(
      `https://api.telegram.org/bot${token}/getUpdates?${params.toString()}`,
      { signal: AbortSignal.timeout(15_000) }
    );
    const body = await response.json().catch(() => null);
    if (!response.ok || !body?.ok) {
      console.error(
        `[telegram-queue] getUpdates failed: ${response.status} ${JSON.stringify(body).slice(0, 500)}`
      );
      return;
    }

    for (const update of body.result || []) {
      updateOffset = Math.max(updateOffset, Number(update.update_id) + 1);
      if (!update.callback_query?.data?.startsWith("task_done:")) continue;

      const crmResponse = await fetch("http://127.0.0.1:3000/api/internal/telegram-updates", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-worker-secret": secret,
        },
        body: JSON.stringify(update),
        signal: AbortSignal.timeout(15_000),
      });
      if (!crmResponse.ok) {
        const text = await crmResponse.text().catch(() => "");
        console.error(`[telegram-queue] callback handling failed: ${crmResponse.status} ${text.slice(0, 500)}`);
      }
    }
  } catch (error) {
    console.error("[telegram-queue] getUpdates error", error);
  } finally {
    updatesProcessing = false;
  }
}

loadEnv();
console.log(`[telegram-queue] worker started, poll interval ${POLL_INTERVAL_MS}ms`);
void tick();
void processTelegramUpdates();
setInterval(() => void tick(), POLL_INTERVAL_MS);
setInterval(() => void processTelegramUpdates(), POLL_INTERVAL_MS);
