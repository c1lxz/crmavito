import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db/prisma";

const schema = z.object({
  returnIds: z.array(z.string().uuid()).min(1).max(200),
}).strict();

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const returnIds = [...new Set(parsed.data.returnIds)];
  const deletedCount = await prisma.$transaction(async (tx) => {
    const returns = await tx.return.findMany({
      where: { id: { in: returnIds } },
      select: { id: true },
    });
    if (returns.length !== returnIds.length) return null;

    await tx.orderItem.updateMany({
      where: { sourceReturnId: { in: returnIds } },
      data: { sourceReturnId: null },
    });
    const result = await tx.return.deleteMany({
      where: { id: { in: returnIds } },
    });
    return result.count;
  });

  if (deletedCount === null) {
    return NextResponse.json(
      { error: "Один из выбранных возвратов уже удалён или не найден" },
      { status: 404 },
    );
  }

  return NextResponse.json({ success: true, deletedCount });
}
