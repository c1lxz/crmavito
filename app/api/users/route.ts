import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db/prisma";
import { z } from "zod";
import { UserRole } from "@prisma/client";

const createSchema = z.object({
  name: z.string().min(1),
  telegramId: z.string().min(1),
  role: z.nativeEnum(UserRole).default("MANAGER"),
});

async function resolveTelegramId(input: string): Promise<string> {
  const value = input.trim();
  if (/^\d+$/.test(value)) return value;

  const username = value.replace(/^@/, "");
  if (!/^[a-zA-Z0-9_]{5,32}$/.test(username)) {
    throw new Error("Введите Telegram ID или username в формате @username");
  }

  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) {
    throw new Error("TELEGRAM_BOT_TOKEN не настроен, username нельзя преобразовать в ID");
  }

  const res = await fetch(`https://api.telegram.org/bot${botToken}/getChat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: `@${username}` }),
    cache: "no-store",
  });
  const data = await res.json();

  if (!res.ok || !data.ok || !data.result?.id) {
    throw new Error("Не удалось найти Telegram ID по username. Пользователь должен быть доступен боту.");
  }

  return String(data.result.id);
}

export async function GET() {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const users = await prisma.user.findMany({
    select: { id: true, name: true, email: true, telegramId: true, role: true, isActive: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  });
  return NextResponse.json(users);
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json();
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  let telegramId: string;
  try {
    telegramId = await resolveTelegramId(parsed.data.telegramId);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Ошибка Telegram" }, { status: 400 });
  }

  const existing = await prisma.user.findUnique({ where: { telegramId } });
  if (existing) return NextResponse.json({ error: "Пользователь с таким Telegram ID уже существует" }, { status: 409 });

  const user = await prisma.user.create({
    data: { name: parsed.data.name, telegramId, role: parsed.data.role },
    select: { id: true, name: true, telegramId: true, role: true, isActive: true, createdAt: true },
  });
  return NextResponse.json(user, { status: 201 });
}
