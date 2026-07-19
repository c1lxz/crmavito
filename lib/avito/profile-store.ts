import { prisma } from "@/lib/db/prisma";
import type { AvitoCredentials } from "@/lib/avito/stocks";
import type { AvitoAccountProfile } from "@/lib/avito/profile";

export type AvitoProfileWithCredentials = {
  id: string;
  name: string;
  accountId: string | null;
  reportEmail: string | null;
  isActive: boolean;
};

const PROFILE_CONTACT_PHONES: Array<{ match: RegExp; phone: string }> = [
  { match: /^BY(?:\s+|$)/i, phone: "79334340391" },
  { match: /^RE(?:\s+|$)/i, phone: "+7 (999) 121-23-49" },
  { match: /^KY(?:\s+|$)/i, phone: "+7 933 432-00-87" },
  { match: /^MU(?:\s+|$)/i, phone: "79082387103" },
  { match: /^LE(?:\s+|$)/i, phone: "79334205210" },
  { match: /^GU(?:\s+|$)/i, phone: "79960199751" },
  { match: /^STROK(?:\s+|$)/i, phone: "79306840311" },
];

export function normalizeAvitoXmlPhone(phone: string): string | undefined {
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("7")) return `+${digits}`;
  if (digits.length === 11 && digits.startsWith("8")) return `+7${digits.slice(1)}`;
  if (digits.length === 10) return `+7${digits}`;
  return undefined;
}

export function avitoXmlPhoneForProfileName(name?: string | null): string | undefined {
  const cleanName = (name ?? "")
    .toUpperCase()
    .replace(/\bSHOP\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const match = PROFILE_CONTACT_PHONES.find((item) => item.match.test(cleanName));
  return match ? normalizeAvitoXmlPhone(match.phone) : undefined;
}

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
      reportEmail: true,
      clientId: true,
      clientSecret: true,
      isActive: true,
    },
  });

  return profiles
    .filter((profile) => profile.clientId && profile.clientSecret)
    .map(({ clientId: _clientId, clientSecret: _clientSecret, ...profile }) => profile);
}

export async function getAvitoCredentials(input: {
  profileId?: string | null;
  clientId?: string | null;
  clientSecret?: string | null;
}): Promise<AvitoCredentials> {
  const manualClientId = input.clientId?.trim();
  const manualClientSecret = input.clientSecret?.trim();
  if (manualClientId || manualClientSecret) {
    if (!manualClientId || !manualClientSecret) {
      throw new Error("Введите client_id и client_secret Avito.");
    }
    return { clientId: manualClientId, clientSecret: manualClientSecret };
  }

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

  throw new Error("Выберите профиль Avito с сохранёнными ключами.");
}

export async function getAvitoProfileReportEmail(profileId?: string | null): Promise<string | undefined> {
  const settings = await getAvitoProfileAutoloadSettings(profileId);
  return settings.reportEmail;
}

export async function getAvitoProfileContactPhone(profileId?: string | null): Promise<string | undefined> {
  const settings = await getAvitoProfileAutoloadSettings(profileId);
  return settings.contactPhone;
}

export async function getAvitoProfileAutoloadSettings(profileId?: string | null): Promise<{
  reportEmail?: string;
  contactPhone?: string;
}> {
  if (!profileId) return {};
  const profile = await prisma.avitoProfile.findFirst({
    where: { id: profileId, isActive: true },
    select: { name: true, reportEmail: true },
  });
  return {
    reportEmail: profile?.reportEmail?.trim() || undefined,
    contactPhone: avitoXmlPhoneForProfileName(profile?.name),
  };
}

export async function saveAvitoProfileCredentials(
  credentials: AvitoCredentials,
  accountProfile: AvitoAccountProfile,
): Promise<AvitoProfileWithCredentials & { clientId: string; clientSecret: string }> {
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
          reportEmail: true,
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
          reportEmail: true,
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
