import { prisma } from "@/lib/db/prisma";

type SessionUser = {
  id?: string | null;
  name?: string | null;
  email?: string | null;
  role?: string | null;
};

function envList(name: string): string[] {
  return (process.env[name] ?? "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
}

export async function isArtistOwner(user: SessionUser | null | undefined): Promise<boolean> {
  if (!user?.id || user.role !== "ADMIN") return false;

  const ownerUserIds = envList("CRM_OWNER_USER_IDS");
  if (ownerUserIds.includes(user.id.toLowerCase())) return true;

  const dbUser = await prisma.user.findUnique({
    where: { id: user.id },
    select: { name: true, login: true, email: true, telegramId: true, telegramUsername: true, role: true },
  });
  if (!dbUser || dbUser.role !== "ADMIN") return false;

  const allowed = new Set([
    "artist",
    "@raised_spent",
    "raised_spent",
    ...envList("CRM_OWNER_TELEGRAM_IDS"),
    ...envList("CRM_OWNER_LOGINS"),
    ...envList("CRM_OWNER_EMAILS"),
  ]);

  return [dbUser.name, dbUser.login, dbUser.email, dbUser.telegramId, dbUser.telegramUsername]
    .filter(Boolean)
    .some((value) => allowed.has(String(value).trim().toLowerCase()));
}

export async function requireArtistOwnerResponse(user: SessionUser | null | undefined) {
  if (await isArtistOwner(user)) return null;
  return Response.json({ error: "Forbidden" }, { status: 403 });
}
