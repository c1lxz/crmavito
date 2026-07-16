import { NextResponse } from "next/server";
import { processPendingOrderNotifications } from "@/lib/telegram/order-notification-queue";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const configuredSecret =
    process.env.TELEGRAM_QUEUE_SECRET ||
    process.env.CRON_SECRET ||
    process.env.TELEGRAM_BOT_TOKEN;
  const providedSecret = request.headers.get("x-worker-secret");

  if (!configuredSecret || !providedSecret || providedSecret !== configuredSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sent = await processPendingOrderNotifications();
  return NextResponse.json({ sent });
}
