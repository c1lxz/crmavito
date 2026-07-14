import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { StocksClient } from "@/components/settings/stocks-client";

export default async function StocksPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (session.user.role !== "ADMIN") redirect("/settings");

  return <StocksClient />;
}
