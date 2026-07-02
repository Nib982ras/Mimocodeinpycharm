import { db } from "@/lib/db";

/**
 * Immutable audit logging for all cryptographic and administrative operations.
 * Mirrors the "Audit & Monitoring System" component from the architecture doc.
 */

export type AuditAction =
  | "UPLOAD"
  | "DOWNLOAD"
  | "VERIFY"
  | "KEY_GEN"
  | "KEY_ROTATE"
  | "KEY_REVOKE"
  | "BRANCH_CREATE"
  | "SEED"
  | "SYSTEM";

export type AuditStatus = "SUCCESS" | "FAILURE" | "WARNING";

export interface AuditEntry {
  action: AuditAction;
  actor: string;
  branchId?: string;
  documentId?: string;
  status: AuditStatus;
  details?: Record<string, unknown>;
  ipAddress?: string;
}

export async function recordAudit(entry: AuditEntry): Promise<void> {
  await db.auditLog.create({
    data: {
      action: entry.action,
      actor: entry.actor,
      branchId: entry.branchId ?? null,
      documentId: entry.documentId ?? null,
      status: entry.status,
      details: entry.details ? JSON.stringify(entry.details) : "{}",
      ipAddress: entry.ipAddress ?? null,
    },
  });
}
