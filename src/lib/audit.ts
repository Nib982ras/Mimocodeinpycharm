import { db } from "@/lib/db";

/**
 * Immutable audit logging for all cryptographic and administrative operations.
 * Mirrors the "Audit & Monitoring System" component from the architecture doc.
 *
 * Each row is append-only; no UPDATE path is used. The `action` field is a
 * free-form string so new event types can be introduced without a migration.
 * The canonical set (mirroring the Prisma schema comment):
 *   LOGIN | LOGOUT | LOGIN_FAILED | 2FA_ENROLL | 2FA_VERIFY | 2FA_FAIL
 *   | UPLOAD | DOWNLOAD | KEY_GEN | KEY_ROTATE | KEY_REVOKE | KEY_DESTROY
 *   | BRANCH_CREATE | SEED | SYSTEM_ACTIVATE | SYSTEM_DEACTIVATE
 *   | LOCKDOWN | LOCKDOWN_RELEASE | USER_SUSPEND | USER_REACTIVATE
 *   | USER_REVOKE | DEVICE_REGISTER | DEVICE_REVOKE | LICENSE_ISSUE
 *   | LICENSE_REVOKE | LICENSE_VALIDATE | UNAUTHORIZED
 */

export type AuditAction = string;

export type AuditStatus = "SUCCESS" | "FAILURE" | "WARNING";

export interface AuditEntry {
  action: AuditAction;
  actor: string;
  actorId?: string;
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
      actorId: entry.actorId ?? null,
      branchId: entry.branchId ?? null,
      documentId: entry.documentId ?? null,
      status: entry.status,
      details: entry.details ? JSON.stringify(entry.details) : "{}",
      ipAddress: entry.ipAddress ?? null,
    },
  });
}

/** Extract a best-effort client IP from a Next.js Request. */
export function clientIp(req: Request): string | undefined {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    undefined
  );
}
