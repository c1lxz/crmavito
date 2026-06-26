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

  const existing = await prisma.user.findUnique({ where: { telegramId: parsed.data.telegramId } });
  if (existing) return NextResponse.json({ error: "Пользователь с таким Telegram ID уже существует" }, { status: 409 });

  const user = await prisma.user.create({
    data: { name: parsed.data.name, telegramId: parsed.data.telegramId, role: parsed.data.role },
    select: { id: true, name: true, telegramId: true, role: true, isActive: true, createdAt: true },
  });
  return NextResponse.json(user, { status: 201 });
}
