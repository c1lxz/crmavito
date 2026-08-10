import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { ContentMachineClient } from "@/components/content-machine/content-machine-client";

export default async function ContentMachinePage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  return <ContentMachineClient canManageBackgrounds={session.user.role === "ADMIN"} />;
}
