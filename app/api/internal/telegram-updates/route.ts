import { NextResponse } from "next/server";
import {
  answerTelegramCallback,
} from "@/lib/telegram/notify";
import { completeTaskFromTelegram } from "@/lib/telegram/task-notification-queue";

export const dynamic = "force-dynamic";

interface TelegramCallbackUpdate {
  callback_query?: {
    id: string;
    data?: string;
    from?: { id?: number };
  };
}

export async function POST(request: Request) {
  const configuredSecret =
    process.env.TELEGRAM_QUEUE_SECRET ||
    process.env.CRON_SECRET ||
    process.env.TELEGRAM_BOT_TOKEN;
  const providedSecret = request.headers.get("x-worker-secret");

  if (!configuredSecret || !providedSecret || providedSecret !== configuredSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const update = (await request.json()) as TelegramCallbackUpdate;
  const callback = update.callback_query;
  const data = callback?.data ?? "";

  if (!callback?.id || !callback.from?.id || !data.startsWith("task_done:")) {
    return NextResponse.json({ ok: true, ignored: true });
  }

  const taskId = data.slice("task_done:".length);
  const result = await completeTaskFromTelegram({
    taskId,
    telegramId: String(callback.from.id),
    callbackQueryId: callback.id,
  });

  if (!result.ok) {
    await answerTelegramCallback(callback.id, result.message).catch(() => null);
  }

  return NextResponse.json(result);
}
