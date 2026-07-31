import { redirect } from "next/navigation";
import { cookies, headers } from "next/headers";
import { auth } from "@/lib/auth";
import { AutoRefresh } from "@/components/layout/auto-refresh";
import { BottomNav } from "@/components/layout/bottom-nav";
import { DesktopSidebar } from "@/components/layout/desktop-sidebar";
import { Toaster } from "@/components/ui/toaster";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const [cookieStore, requestHeaders] = await Promise.all([cookies(), headers()]);
  const savedMode = cookieStore.get("crmavito-ui-mode")?.value;
  const forcedMode = requestHeaders.get("x-crmavito-ui-mode");
  const mode = forcedMode === "m" || forcedMode === "pc"
    ? forcedMode
    : savedMode === "m" ? "m" : "pc";
  const isPc = mode === "pc";

  return (
    <div className={isPc ? "pc-shell min-h-screen bg-secondary/45" : "mobile-shell min-h-screen bg-background"}>
      <AutoRefresh />
      {isPc ? <DesktopSidebar /> : null}
      <main
        className={
          isPc
            ? "min-h-screen min-w-0 overflow-x-clip bg-background lg:ml-64"
            : "mx-auto min-h-screen max-w-xl bg-background shadow-[0_0_0_1px_hsl(var(--border))]"
        }
      >
        {children}
      </main>
      {isPc ? null : <BottomNav />}
      <Toaster />
    </div>
  );
}
