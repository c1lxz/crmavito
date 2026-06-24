import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { SettingsClient } from "@/components/settings/settings-client";

export default async function SettingsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  return (
    <SettingsClient
      user={{
        name: session.user.name ?? "",
        email: session.user.email ?? "",
        role: session.user.role ?? "MANAGER",
      }}
    />
  );
}
