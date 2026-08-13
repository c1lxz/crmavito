import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db/prisma";
import { isArtistOwner } from "@/lib/auth/artist-owner";

type RouteContext = { params: Promise<{ id: string }> };

const updateSchema = z.object({
  name: z.string().trim().min(1).optional(),
  color: z.string().trim().nullable().optional(),
  clientId: z.string().trim().nullable().optional(),
  clientSecret: z.string().trim().nullable().optional(),
  reportEmail: z.string().trim().email().nullable().optional(),
  contactPhone: z.string().trim().nullable().optional(),
  isActive: z.boolean().optional(),
});

export async function PATCH(req: NextRequest, { params }: RouteContext) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const parsed = updateSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const artistOwner = await isArtistOwner(session.user);
  const secretKeys = ["clientId", "clientSecret", "reportEmail", "contactPhone"] as const;
  const hasSecretFields = secretKeys.some((key) => key in parsed.data);
  if (hasSecretFields && !artistOwner) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const {
    clientId,
    clientSecret,
    reportEmail,
    contactPhone,
    ...publicData
  } = parsed.data;
  const data = artistOwner
    ? {
        ...publicData,
        ...(clientId?.trim() ? { clientId: clientId.trim() } : {}),
        ...(clientSecret?.trim() ? { clientSecret: clientSecret.trim() } : {}),
        ...(reportEmail?.trim() ? { reportEmail: reportEmail.trim() } : {}),
        ...(contactPhone?.trim() ? { contactPhone: contactPhone.trim() } : {}),
      }
    : {
        name: parsed.data.name,
        color: parsed.data.color,
        isActive: parsed.data.isActive,
      };

  const profile = await prisma.avitoProfile.update({
    where: { id },
    data,
  });
  return NextResponse.json(profile);
}

export async function DELETE(_req: NextRequest, { params }: RouteContext) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await isArtistOwner(session.user))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const profile = await prisma.avitoProfile.update({
    where: { id },
    data: { isActive: false },
  });
  return NextResponse.json(profile);
}
