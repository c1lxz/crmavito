import { prisma } from "./prisma";
import { AuditEntityType, Prisma } from "@prisma/client";

interface AuditEntry {
  entityType: AuditEntityType;
  entityId: string;
  userId: string;
  fieldName: string;
  oldValue?: string | null;
  newValue?: string | null;
}

export async function createAuditLog(
  entry: AuditEntry,
  tx?: Prisma.TransactionClient
) {
  const db = tx ?? prisma;
  await db.auditLog.create({
    data: {
      entityType: entry.entityType,
      entityId: entry.entityId,
      userId: entry.userId,
      fieldName: entry.fieldName,
      oldValue: entry.oldValue ?? null,
      newValue: entry.newValue ?? null,
    },
  });
}
