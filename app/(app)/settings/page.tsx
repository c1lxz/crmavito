import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db/prisma";
import { SettingsClient } from "@/components/settings/settings-client";

export default async function SettingsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const users = session.user.role === "ADMIN"
    ? await prisma.user.findMany({
        select: { id: true, name: true, telegramId: true, role: true, isActive: true },
        orderBy: { createdAt: "asc" },
      })
    : [];

  return (
    <SettingsClient
      user={{
        id: session.user.id ?? "",
        name: session.user.name ?? "",
        email: session.user.email ?? "",
        role: session.user.role ?? "MANAGER",
      }}
      users={users}
    />
  );
}
