import { prisma } from "@/lib/db/prisma";
import { requireAdmin } from "@/lib/auth/session";
import { redirect } from "next/navigation";
import { AuditLogClient } from "@/components/audit-log/audit-log-client";

async function getAuditLogs() {
  const logs = await prisma.auditLog.findMany({
    orderBy: { timestamp: "desc" },
    take: 200,
    include: { user: { select: { name: true, email: true } } },
  });

  return logs.map((l) => ({
    id: l.id,
    entityType: l.entityType,
    entityId: l.entityId,
    fieldName: l.fieldName,
    oldValue: l.oldValue,
    newValue: l.newValue,
    timestamp: l.timestamp.toISOString(),
    user: l.user,
  }));
}

export default async function AuditLogPage() {
  try {
    await requireAdmin();
  } catch {
    redirect("/dashboard");
  }

  const logs = await getAuditLogs();
  return <AuditLogClient logs={logs} />;
}
