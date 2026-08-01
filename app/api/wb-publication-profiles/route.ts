import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db/prisma";
import { isWbPublicationOwner } from "@/lib/auth/wb-publication-owner";
import { normalizeWbProfileName } from "@/lib/wbr/private-publication-profiles";

const profileSchema = z.object({
  name: z.string().trim().min(2).max(60),
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

  const profile = await prisma.wbPrivatePublicationProfile.upsert({
    where: { normalizedName: normalizeWbProfileName(parsed.data.name) },
    update: { displayName: parsed.data.name, ownerUserId: session.user.id },
    create: {
      normalizedName: normalizeWbProfileName(parsed.data.name),
      displayName: parsed.data.name,
      ownerUserId: session.user.id,
    },
    select: { displayName: true },
  });

  return NextResponse.json({ profile }, { status: 201 });
}
