import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db/prisma";
import { SettingsClient } from "@/components/settings/settings-client";

export default async function SettingsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

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
      }}
      users={users}
      avitoProfiles={avitoProfiles.map((profile) => ({
        id: profile.id,
        name: profile.name,
        color: profile.color,
        isActive: profile.isActive,
      }))}
    />
  );
}
