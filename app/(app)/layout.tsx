import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { AutoRefresh } from "@/components/layout/auto-refresh";
import { BottomNav } from "@/components/layout/bottom-nav";
import { Toaster } from "@/components/ui/toaster";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  return (
    <div className="mx-auto min-h-screen max-w-xl bg-background shadow-[0_0_0_1px_hsl(var(--border))]">
      <AutoRefresh />
      <main>{children}</main>
      <BottomNav />
      <Toaster />
    </div>
  );
}
