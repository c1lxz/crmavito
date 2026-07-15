import { prisma } from "@/lib/db/prisma";
import type { AvitoCredentials } from "@/lib/avito/stocks";
import type { AvitoAccountProfile } from "@/lib/avito/profile";

export type AvitoProfileWithCredentials = {
  id: string;
  name: string;
  accountId: string | null;
  clientId: string;
  clientSecret: string;
  isActive: boolean;
};

export async function listAvitoProfilesWithCredentials(): Promise<AvitoProfileWithCredentials[]> {
  const profiles = await prisma.avitoProfile.findMany({
    where: {
      isActive: true,
      clientId: { not: null },
      clientSecret: { not: null },
    },
    orderBy: [{ name: "asc" }],
    select: {
      id: true,
      name: true,
      accountId: true,
      clientId: true,
      clientSecret: true,
      isActive: true,
    },
  });

  return profiles
    .filter((profile) => profile.clientId && profile.clientSecret)
    .map((profile) => ({
      ...profile,
      clientId: profile.clientId ?? "",
      clientSecret: profile.clientSecret ?? "",
    }));
}

export async function getAvitoCredentials(input: {
  profileId?: string | null;
  clientId?: string | null;
  clientSecret?: string | null;
}): Promise<AvitoCredentials> {
  if (input.profileId) {
    const profile = await prisma.avitoProfile.findFirst({
      where: {
        id: input.profileId,
        isActive: true,
        clientId: { not: null },
        clientSecret: { not: null },
      },
      select: { clientId: true, clientSecret: true },
    });

    if (!profile?.clientId || !profile.clientSecret) {
      throw new Error("У выбранного профиля Avito не сохранены client_id и client_secret.");
    }

    return {
      clientId: profile.clientId,
      clientSecret: profile.clientSecret,
    };
  }

  const clientId = input.clientId?.trim();
  const clientSecret = input.clientSecret?.trim();
  if (!clientId || !clientSecret) {
    throw new Error("Укажите профиль Avito или client_id и client_secret.");
  }

  return { clientId, clientSecret };
}

export async function saveAvitoProfileCredentials(
  credentials: AvitoCredentials,
  accountProfile: AvitoAccountProfile,
): Promise<AvitoProfileWithCredentials> {
  const accountId = accountProfile.id === "unknown" ? null : accountProfile.id;
  const existing = await prisma.avitoProfile.findFirst({
    where: {
      OR: [
        { clientId: credentials.clientId },
        ...(accountId ? [{ accountId }] : []),
      ],
    },
    select: { id: true },
  });

  const data = {
    name: await uniqueProfileName(accountProfile.name, existing?.id),
    accountId,
    clientId: credentials.clientId,
    clientSecret: credentials.clientSecret,
    isActive: true,
  };

  const profile = existing
    ? await prisma.avitoProfile.update({
        where: { id: existing.id },
        data,
        select: {
          id: true,
          name: true,
          accountId: true,
          clientId: true,
          clientSecret: true,
          isActive: true,
        },
      })
    : await prisma.avitoProfile.create({
        data,
        select: {
          id: true,
          name: true,
          accountId: true,
          clientId: true,
          clientSecret: true,
          isActive: true,
        },
      });

  return {
    ...profile,
    clientId: profile.clientId ?? "",
    clientSecret: profile.clientSecret ?? "",
  };
}

async function uniqueProfileName(baseName: string, excludeId?: string): Promise<string> {
  const cleanName = baseName.trim() || "Avito";
  let candidate = cleanName;
  let suffix = 2;

  while (
    await prisma.avitoProfile.findFirst({
      where: {
        name: candidate,
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
      select: { id: true },
    })
  ) {
    candidate = `${cleanName} ${suffix}`;
    suffix += 1;
  }

  return candidate;
}
