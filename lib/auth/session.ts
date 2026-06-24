import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";

export async function requireAuth() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  return session.user;
}

export async function requireAdmin() {
  const user = await requireAuth();
  if (user.role !== "ADMIN") throw new Error("Forbidden");
  return user;
}

export const ADMIN_ONLY_ACTIONS = [
  "manage_users",
  "manage_roles",
  "manage_avito_settings",
  "view_audit_log",
] as const;

export type AdminAction = (typeof ADMIN_ONLY_ACTIONS)[number];

export function assertAdmin(role: string | undefined) {
  if (role !== "ADMIN") {
    throw new Response("Forbidden", { status: 403 });
  }
}
