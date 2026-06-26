const fs = require("fs");
const path = require("path");

const INTERVAL_MS = 60 * 60 * 1000;

function loadEnv() {
  const envPath = path.join(process.cwd(), ".env");
  if (!fs.existsSync(envPath)) return;

  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)\s*$/);
    if (!match || process.env[match[1]]) continue;

    let value = match[2];
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }

    process.env[match[1]] = value;
  }
}

function getSyncUrl() {
  const baseUrl =
    process.env.AVITO_SYNC_URL ||
    process.env.NEXTAUTH_URL ||
    process.env.AUTH_URL ||
    "http://127.0.0.1:3000";

  return new URL("/api/products/sync", baseUrl).toString();
}

async function runSync() {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    console.error("[avito-sync-worker] CRON_SECRET is not set");
    return;
  }

  const startedAt = new Date();
  const url = getSyncUrl();
  console.log(`[avito-sync-worker] sync started: ${startedAt.toISOString()} ${url}`);

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "x-cron-secret": cronSecret },
    });
    const text = await response.text();

    if (!response.ok) {
      console.error(`[avito-sync-worker] sync failed: ${response.status} ${text.slice(0, 500)}`);
      return;
    }

    console.log(`[avito-sync-worker] sync completed: ${text.slice(0, 500)}`);
  } catch (error) {
    console.error("[avito-sync-worker] sync error", error);
  }
}

loadEnv();
runSync();
setInterval(runSync, INTERVAL_MS);
