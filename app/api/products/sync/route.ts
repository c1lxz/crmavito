import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db/prisma";
import { syncAvitoProducts, type SyncResult } from "@/lib/avito/sync";
import { consolidateDuplicateProducts, prepareProductNames } from "@/lib/db/product-deduplication";

export const maxDuration = 300;
let activeSync: Promise<MultiSyncResult> | null = null;

type MultiSyncResult = {
  created: number;
  updated: number;
  archived: number;
  total: number;
  imagesFound: number;
  profiles: Array<SyncResult & { profileName: string }>;
  errors: Array<{ profileId: string; profileName: string; error: string }>;
  merged: number;
};

function errorResponse(message: string, status: number, details?: string) {
  const error = details ? `${message}: ${details.slice(0, 300)}` : message;
  console.error("[avito-sync]", error);
  return NextResponse.json({ error }, { status });
}

async function syncProfiles(profileIds?: string[]): Promise<MultiSyncResult> {
  const profiles = await prisma.avitoProfile.findMany({
    where: {
      isActive: true,
      clientId: { not: null },
      clientSecret: { not: null },
      ...(profileIds ? { id: { in: profileIds } } : {}),
    },
    orderBy: { name: "asc" },
    select: { id: true, name: true, clientId: true, clientSecret: true },
  });

  if (profileIds && profiles.length !== new Set(profileIds).size) {
    throw new Error("Один или несколько выбранных профилей неактивны или не имеют API-ключей.");
  }
  if (profiles.length === 0) {
    throw new Error("Нет активных профилей Avito с сохранёнными API-ключами.");
  }

  const result: MultiSyncResult = {
    created: 0,
    updated: 0,
    archived: 0,
    total: 0,
    imagesFound: 0,
    profiles: [],
    errors: [],
    merged: 0,
  };

  await prepareProductNames(prisma);

  // Avito aggressively limits parallel requests, so profiles are synchronized one by one.
  for (const profile of profiles) {
    try {
      const profileResult = await syncAvitoProducts(
        prisma,
        { clientId: profile.clientId!, clientSecret: profile.clientSecret! },
        { profileId: profile.id, enrichMissingImages: false },
      );
      result.profiles.push({ ...profileResult, profileName: profile.name });
      result.created += profileResult.created;
      result.updated += profileResult.updated;
      result.archived += profileResult.archived;
      result.total += profileResult.total;
      result.imagesFound += profileResult.imagesFound;
    } catch (error) {
      result.errors.push({
        profileId: profile.id,
        profileName: profile.name,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (result.profiles.length === 0) {
    throw new Error(result.errors.map((item) => `${item.profileName}: ${item.error}`).join("; "));
  }
  result.merged = await consolidateDuplicateProducts(prisma);
  return result;
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

  let profileIds: string[] | undefined;
  if (!isCron) {
    const body = await req.json().catch(() => ({})) as { profileIds?: unknown };
    if (!Array.isArray(body.profileIds) || body.profileIds.length === 0 || body.profileIds.some((id) => typeof id !== "string")) {
      return NextResponse.json({ error: "Выберите хотя бы один профиль Avito." }, { status: 400 });
    }
    profileIds = [...new Set(body.profileIds as string[])];
  }

  try {
    activeSync = syncProfiles(profileIds);
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
