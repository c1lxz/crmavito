import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db/prisma";
import { SettingsClient } from "@/components/settings/settings-client";
import { isArtistOwner } from "@/lib/auth/artist-owner";

export default async function SettingsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const artistOwner = await isArtistOwner(session.user);

  const [users, avitoProfiles] = session.user.role === "ADMIN"
    ? await Promise.all([
      prisma.user.findMany({
        select: {
          id: true,
          name: true,
          login: true,
          telegramId: true,
          credentialsDeliveredAt: true,
          credentialsDeliveryError: true,
          role: true,
          isActive: true,
        },
        orderBy: { createdAt: "asc" },
      }),
      prisma.avitoProfile.findMany({
        orderBy: [{ isActive: "desc" }, { name: "asc" }],
        select: {
          id: true,
          name: true,
          color: true,
          accountId: true,
          isActive: true,
          ...(artistOwner
            ? {
                clientId: true,
                clientSecret: true,
                reportEmail: true,
                contactPhone: true,
              }
            : {}),
        },
      }),
    ])
    : [[], []];

  return (
    <SettingsClient
      user={{
        id: session.user.id ?? "",
        name: session.user.name ?? "",
        email: session.user.email ?? "",
        role: session.user.role ?? "MANAGER",
        isOwner: artistOwner,
      }}
      users={users}
      avitoProfiles={avitoProfiles.map((profile) => ({
        id: profile.id,
        name: profile.name,
        color: profile.color,
        accountId: profile.accountId,
        clientId: "clientId" in profile ? profile.clientId : null,
        clientSecret: "clientSecret" in profile ? profile.clientSecret : null,
        reportEmail: "reportEmail" in profile ? profile.reportEmail : null,
        contactPhone: "contactPhone" in profile ? profile.contactPhone : null,
        isActive: profile.isActive,
      }))}
    />
  );
}
