import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db/prisma";
import { isWbPublicationOwner } from "@/lib/auth/wb-publication-owner";
import { normalizeWbProfileName } from "@/lib/wbr/private-publication-profiles";

const profileSchema = z.object({
  names: z.array(z.string().trim().min(2).max(60)).min(1).max(100),
});

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user || !(await isWbPublicationOwner(session.user))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const parsed = profileSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const names = [...new Map(
    parsed.data.names.map((name) => [normalizeWbProfileName(name), name]),
  ).values()];
  const profiles = await prisma.$transaction(
    names.map((name) => prisma.wbPrivatePublicationProfile.upsert({
      where: { normalizedName: normalizeWbProfileName(name) },
      update: { displayName: name, ownerUserId: session.user.id },
      create: {
        normalizedName: normalizeWbProfileName(name),
        displayName: name,
        ownerUserId: session.user.id,
      },
      select: { displayName: true },
    })),
  );

  return NextResponse.json({ profiles }, { status: 201 });
}
