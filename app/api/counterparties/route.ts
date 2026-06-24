import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db/prisma";
import { z } from "zod";

const createSchema = z.object({
  name: z.string().min(1),
  contactInfo: z.string().optional(),
  comment: z.string().optional(),
});

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const search = searchParams.get("search");

  const counterparties = await prisma.counterparty.findMany({
    where: search ? { name: { contains: search, mode: "insensitive" } } : {},
    orderBy: { name: "asc" },
  });
  return NextResponse.json(counterparties);
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const cp = await prisma.counterparty.create({ data: parsed.data });
  return NextResponse.json(cp, { status: 201 });
}
