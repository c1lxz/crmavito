import { prisma } from "@/lib/db/prisma";

const WB_PUBLICATION_OWNER_LOGIN = "crm_5039428987";
const WB_PUBLICATION_OWNER_TELEGRAM_ID = "5039428987";

type SessionUser = {
  id?: string | null;
};

type PublicationOwnerIdentity = {
  login?: string | null;
  telegramId?: string | null;
  isActive?: boolean;
};

export function matchesWbPublicationOwner(user: PublicationOwnerIdentity | null | undefined): boolean {
  return Boolean(
    user?.isActive &&
      user.login?.trim().toLowerCase() === WB_PUBLICATION_OWNER_LOGIN &&
      user.telegramId?.trim() === WB_PUBLICATION_OWNER_TELEGRAM_ID,
  );
}

export async function isWbPublicationOwner(user: SessionUser | null | undefined): Promise<boolean> {
  if (!user?.id) return false;

  const dbUser = await prisma.user.findUnique({
    where: { id: user.id },
    select: { login: true, telegramId: true, isActive: true },
  });

  return matchesWbPublicationOwner(dbUser);
}
