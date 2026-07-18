import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { fetchAvitoStockItemsResult } from "@/lib/avito/stocks";
import { getAvitoCredentials } from "@/lib/avito/profile-store";

export const maxDuration = 300;

const credentialsSchema = z.object({
  profileId: z.string().trim().optional().nullable(),
  clientId: z.string().trim().optional().nullable(),
  clientSecret: z.string().trim().optional().nullable(),
});

async function requireAdminResponse() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Не авторизован." }, { status: 401 });
  if (session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Недостаточно прав." }, { status: 403 });
  }
  return null;
}

export async function POST(request: Request) {
  const forbidden = await requireAdminResponse();
  if (forbidden) return forbidden;

  const parsed = credentialsSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "Выберите профиль Avito." }, { status: 400 });
  }

  let credentials;
  try {
    credentials = await getAvitoCredentials(parsed.data);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 400 },
    );
  }

  try {
    const attempts = [
      { listingPerPage: 25, pageDelayMs: 1_500, listingRequestTimeoutMs: 45_000, listingMaxPages: 160 },
      { listingPerPage: 10, pageDelayMs: 1_000, listingRequestTimeoutMs: 45_000, listingMaxPages: 260 },
      { listingPerPage: 5, pageDelayMs: 700, listingRequestTimeoutMs: 45_000, listingMaxPages: 520 },
    ];
    let lastError: unknown;
    for (const [index, attempt] of attempts.entries()) {
      try {
        const result = await fetchAvitoStockItemsResult(credentials, {
          skipStocks: true,
          listingEmptyPagesToStop: 3,
          listingAllowPartial: true,
          ...attempt,
        });
        return NextResponse.json({
          ...result,
          warning: [
            result.warning,
            index > 0 ? `Avito ответил ошибкой на быстрой загрузке, поэтому объявления загружены медленным режимом ${attempt.listingPerPage} на страницу.` : undefined,
          ].filter(Boolean).join(" ") || undefined,
        });
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError;
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 502 },
    );
  }
}
