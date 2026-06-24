import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db/prisma";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status");
  const search = searchParams.get("search");
  const reason = searchParams.get("reason");

  const where: Record<string, unknown> = {};
  if (status) where.status = status;
  if (reason) where.reason = { contains: reason, mode: "insensitive" };
  if (search) {
    where.OR = [
      { trackingNumber: { contains: search, mode: "insensitive" } },
      { order: { productNameSnapshot: { contains: search, mode: "insensitive" } } },
    ];
  }

  const returns = await prisma.return.findMany({
    where,
    include: { order: true, product: true },
    orderBy: { createdAt: "desc" },
  });

  const [totalReturning, totalReturned] = await Promise.all([
    prisma.return.count({ where: { status: "RETURNING" } }),
    prisma.return.count({ where: { status: "RETURNED" } }),
  ]);

  return NextResponse.json({ returns, totalReturning, totalReturned, total: returns.length });
}
