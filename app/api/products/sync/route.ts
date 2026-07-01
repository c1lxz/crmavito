import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db/prisma";
import { syncAvitoProducts } from "@/lib/avito/sync";

export const maxDuration = 300;
let activeSync: Promise<Awaited<ReturnType<typeof syncAvitoProducts>>> | null = null;

function errorResponse(message: string, status: number, details?: string) {
  const error = details ? `${message}: ${details.slice(0, 300)}` : message;
  console.error("[avito-sync]", error);
  return NextResponse.json({ error }, { status });
}

export async function POST(req: Request) {
  const cronSecret = process.env.CRON_SECRET;
  const headerSecret = req.headers.get("x-cron-secret");
  const isCron = Boolean(cronSecret && headerSecret === cronSecret);

  if (!isCron) {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Не авторизован." }, { status: 401 });
    if (session.user.role !== "ADMIN") {
      return NextResponse.json({ error: "Недостаточно прав." }, { status: 403 });
    }
  }

  if (activeSync) {
    return NextResponse.json(
      { error: "Синхронизация уже выполняется. Дождитесь её завершения." },
      { status: 409 },
    );
  }

  const clientId = process.env.AVITO_CLIENT_ID;
  const clientSecret = process.env.AVITO_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return errorResponse(
      "Avito API не настроен. Проверьте AVITO_CLIENT_ID и AVITO_CLIENT_SECRET в .env.",
      503,
    );
  }

  try {
    activeSync = syncAvitoProducts(prisma, { clientId, clientSecret });
    const result = await activeSync;
    revalidatePath("/products");
    revalidatePath("/orders");
    revalidatePath("/dashboard");
    console.log("[avito-sync] completed", result);
    return NextResponse.json(result);
  } catch (error) {
    return errorResponse("Ошибка синхронизации Avito", 500, error instanceof Error ? error.message : String(error));
  } finally {
    activeSync = null;
  }
}
