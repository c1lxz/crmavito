import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { WbResaleClient } from "@/components/wbr/wb-resale-client";
import { isWbPublicationOwner } from "@/lib/auth/wb-publication-owner";

export default async function WbResalePage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const canManagePublication = await isWbPublicationOwner(session.user);

  return <WbResaleClient canManagePublication={canManagePublication} />;
}
