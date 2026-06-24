import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db/prisma";
import { z } from "zod";
import { ExpenseCategory } from "@prisma/client";
import { toDecimalNumber } from "@/lib/db/orders";

const createSchema = z.object({
  date: z.string(),
  category: z.nativeEnum(ExpenseCategory),
  title: z.string().optional(),
  amount: z.number().positive(),
  paymentMethod: z.string().optional(),
  comment: z.string().optional(),
});

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const category = searchParams.get("category");
  const paymentMethod = searchParams.get("paymentMethod");
  const dateFrom = searchParams.get("dateFrom");
  const dateTo = searchParams.get("dateTo");
  const search = searchParams.get("search");

  const where: Record<string, unknown> = {};
  if (category) where.category = category;
  if (paymentMethod) where.paymentMethod = { contains: paymentMethod, mode: "insensitive" };
  if (search) where.title = { contains: search, mode: "insensitive" };
  if (dateFrom || dateTo) {
    where.date = {};
    if (dateFrom) (where.date as Record<string, Date>).gte = new Date(dateFrom);
    if (dateTo) (where.date as Record<string, Date>).lte = new Date(dateTo);
  }

  const expenses = await prisma.expense.findMany({
    where,
    orderBy: { date: "desc" },
    include: { createdBy: { select: { name: true } } },
  });

  const total = expenses.reduce((s, e) => s + toDecimalNumber(e.amount), 0);
  const byCategory = expenses.reduce((acc, e) => {
    acc[e.category] = (acc[e.category] ?? 0) + toDecimalNumber(e.amount);
    return acc;
  }, {} as Record<string, number>);

  return NextResponse.json({ expenses, total, byCategory });
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const expense = await prisma.expense.create({
    data: { ...parsed.data, date: new Date(parsed.data.date), createdByUserId: session.user.id },
  });
  return NextResponse.json(expense, { status: 201 });
}
