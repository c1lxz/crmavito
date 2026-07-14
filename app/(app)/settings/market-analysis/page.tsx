import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { MarketAnalysisClient } from "@/components/settings/market-analysis-client";

export default async function MarketAnalysisPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (session.user.role !== "ADMIN") redirect("/settings");

  return <MarketAnalysisClient />;
}
