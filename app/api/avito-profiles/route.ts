import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db/prisma";
import { isArtistOwner } from "@/lib/auth/artist-owner";

const createSchema = z.object({
  name: z.string().trim().min(1),
  color: z.string().trim().optional(),
});

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const profiles = await prisma.avitoProfile.findMany({
    orderBy: [{ isActive: "desc" }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      color: true,
      accountId: true,
      isActive: true,
      createdAt: true,
      updatedAt: true,
    },
  });
  return NextResponse.json(profiles);
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await isArtistOwner(session.user))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const profile = await prisma.avitoProfile.create({
    data: {
      name: parsed.data.name,
      color: parsed.data.color || null,
    },
  });
  return NextResponse.json(profile, { status: 201 });
}
