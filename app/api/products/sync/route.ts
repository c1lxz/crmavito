import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db/prisma";

export async function POST() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const clientId = process.env.AVITO_CLIENT_ID;
  const clientSecret = process.env.AVITO_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    return NextResponse.json({ error: "Avito API не настроен. Укажите AVITO_CLIENT_ID и AVITO_CLIENT_SECRET." }, { status: 503 });
  }

  try {
    const tokenRes = await fetch("https://api.avito.ru/token/", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "client_credentials", client_id: clientId, client_secret: clientSecret }),
    });
    if (!tokenRes.ok) {
      return NextResponse.json({ error: "Ошибка авторизации в Avito API" }, { status: 502 });
    }
    const { access_token } = await tokenRes.json() as { access_token: string };

    const listingsRes = await fetch("https://api.avito.ru/core/v1/items/?status=active&per_page=100", {
      headers: { Authorization: `Bearer ${access_token}` },
    });
    if (!listingsRes.ok) {
      return NextResponse.json({ error: "Ошибка получения объявлений из Avito" }, { status: 502 });
    }
    const listingsData = await listingsRes.json() as { resources: Array<{ id: number; title: string; price: number; url: string; status: string }> };

    let updated = 0;
    let created = 0;
    const now = new Date();

    for (const item of listingsData.resources ?? []) {
      const avitoItemId = String(item.id);
      const existing = await prisma.product.findUnique({ where: { avitoItemId } });
      if (existing) {
        await prisma.product.update({
          where: { avitoItemId },
          data: { name: item.title, salePrice: item.price, avitoListingUrl: item.url, avitoListingStatus: item.status, lastSyncedAt: now },
        });
        updated++;
      } else {
        await prisma.product.create({
          data: { name: item.title, salePrice: item.price, avitoItemId, avitoListingUrl: item.url, avitoListingStatus: item.status, lastSyncedAt: now },
        });
        created++;
      }
    }

    return NextResponse.json({ updated, created, total: listingsData.resources?.length ?? 0 });
  } catch {
    return NextResponse.json({ error: "Ошибка синхронизации с Avito" }, { status: 500 });
  }
}
