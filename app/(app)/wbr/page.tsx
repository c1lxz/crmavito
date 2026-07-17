import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { WbResaleClient } from "@/components/wbr/wb-resale-client";

export default async function WbResalePage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  return <WbResaleClient />;
}
