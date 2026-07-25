import { db } from "@/lib/db";

/**
 * Document expiry/TTL service.
 *
 * Provides:
 *   - Automatic document expiration
 *   - Expiry enforcement on access
 *   - Background cleanup of expired documents
 *   - Configurable retention policies
 */

// ---------- Types ----------

export interface ExpiryConfig {
  /** Default retention period in days (null = no expiry) */
  defaultRetentionDays?: number | null;
  /** Maximum retention period in days (null = no limit) */
  maxRetentionDays?: number | null;
  /** Whether to soft-delete or hard-delete expired documents */
  softDelete: boolean;
}

// ---------- Configuration ----------

const DEFAULT_CONFIG: ExpiryConfig = {
  defaultRetentionDays: null, // No default expiry
  maxRetentionDays: 365, // 1 year maximum
  softDelete: true, // Soft-delete by default
};

/**
 * Get expiry configuration from environment.
 */
function getExpiryConfig(): ExpiryConfig {
  return {
    defaultRetentionDays: process.env.DOCUMENT_DEFAULT_RETENTION_DAYS
      ? parseInt(process.env.DOCUMENT_DEFAULT_RETENTION_DAYS, 10)
      : null,
    maxRetentionDays: process.env.DOCUMENT_MAX_RETENTION_DAYS
      ? parseInt(process.env.DOCUMENT_MAX_RETENTION_DAYS, 10)
      : 365,
    softDelete: process.env.DOCUMENT_EXPIRY_SOFT_DELETE !== "false",
  };
}

// ---------- Expiry checking ----------

/**
 * Check if a document has expired.
 */
export async function isDocumentExpired(documentId: string): Promise<boolean> {
  const doc = await db.document.findUnique({
    where: { id: documentId },
    select: { expiresAt: true, status: true },
  });

  if (!doc) return false;
  if (doc.status === "PURGED") return false; // Already purged
  if (!doc.expiresAt) return false; // No expiry set

  return doc.expiresAt < new Date();
}

/**
 * Check if a document is expired or will expire soon.
 * Returns true if document expires within the given hours.
 */
export async function isDocumentExpiringSoon(
  documentId: string,
  hours: number = 24
): Promise<boolean> {
  const doc = await db.document.findUnique({
    where: { id: documentId },
    select: { expiresAt: true, status: true },
  });

  if (!doc) return false;
  if (doc.status === "PURGED") return false;
  if (!doc.expiresAt) return false;

  const threshold = new Date(Date.now() + hours * 60 * 60 * 1000);
  return doc.expiresAt < threshold;
}

// ---------- Expiry enforcement ----------

/**
 * Enforce document expiry on access.
 * Returns null if document is accessible, or error response if expired.
 */
export async function enforceDocumentExpiry(documentId: string): Promise<{
  allowed: boolean;
  expired: boolean;
  expiresAt?: Date;
  error?: string;
}> {
  const doc = await db.document.findUnique({
    where: { id: documentId },
    select: { expiresAt: true, status: true },
  });

  if (!doc) {
    return { allowed: false, expired: false, error: "Document not found" };
  }

  if (doc.status === "PURGED") {
    return { allowed: false, expired: true, error: "Document has been purged" };
  }

  if (!doc.expiresAt) {
    return { allowed: true, expired: false };
  }

  if (doc.expiresAt < new Date()) {
    return {
      allowed: false,
      expired: true,
      expiresAt: doc.expiresAt,
      error: "Document has expired",
    };
  }

  return { allowed: true, expired: false, expiresAt: doc.expiresAt };
}

// ---------- Expiry management ----------

/**
 * Set document expiry.
 */
export async function setDocumentExpiry(
  documentId: string,
  expiresAt: Date | null
): Promise<void> {
  const config = getExpiryConfig();

  // Validate against max retention
  if (expiresAt && config.maxRetentionDays) {
    const maxDate = new Date(Date.now() + config.maxRetentionDays * 24 * 60 * 60 * 1000);
    if (expiresAt > maxDate) {
      throw new Error(`Expiry cannot exceed ${config.maxRetentionDays} days from now`);
    }
  }

  await db.document.update({
    where: { id: documentId },
    data: { expiresAt },
  });
}

/**
 * Extend document expiry.
 */
export async function extendDocumentExpiry(
  documentId: string,
  additionalDays: number
): Promise<Date> {
  const doc = await db.document.findUnique({
    where: { id: documentId },
    select: { expiresAt: true },
  });

  if (!doc) throw new Error("Document not found");

  const currentExpiry = doc.expiresAt || new Date();
  const newExpiry = new Date(currentExpiry.getTime() + additionalDays * 24 * 60 * 60 * 1000);

  await setDocumentExpiry(documentId, newExpiry);
  return newExpiry;
}

/**
 * Get document expiry info.
 */
export async function getDocumentExpiryInfo(documentId: string): Promise<{
  expiresAt: Date | null;
  expired: boolean;
  daysUntilExpiry: number | null;
}> {
  const doc = await db.document.findUnique({
    where: { id: documentId },
    select: { expiresAt: true, status: true },
  });

  if (!doc) throw new Error("Document not found");

  const expired = doc.expiresAt ? doc.expiresAt < new Date() : false;
  const daysUntilExpiry = doc.expiresAt
    ? Math.ceil((doc.expiresAt.getTime() - Date.now()) / (24 * 60 * 60 * 1000))
    : null;

  return {
    expiresAt: doc.expiresAt,
    expired,
    daysUntilExpiry,
  };
}

// ---------- Cleanup ----------

/**
 * Clean up expired documents.
 * Marks expired documents as PURGED and optionally deletes ciphertext.
 */
export async function cleanupExpiredDocuments(): Promise<{
  expired: number;
  purged: number;
}> {
  const config = getExpiryConfig();
  const now = new Date();

  // Find expired documents
  const expiredDocs = await db.document.findMany({
    where: {
      expiresAt: { lt: now },
      status: { not: "PURGED" },
    },
    select: { id: true, storagePath: true },
  });

  if (expiredDocs.length === 0) {
    return { expired: 0, purged: 0 };
  }

  let purged = 0;

  for (const doc of expiredDocs) {
    try {
      if (config.softDelete) {
        // Soft-delete: mark as PURGED
        await db.document.update({
          where: { id: doc.id },
          data: { status: "PURGED" },
        });
      } else {
        // Hard-delete: remove from database
        // Note: ciphertext cleanup should be handled separately
        await db.document.delete({
          where: { id: doc.id },
        });
      }
      purged++;
    } catch (err) {
      console.error(`[document-expiry] Failed to purge document ${doc.id}:`, err);
    }
  }

  console.log(`[document-expiry] Purged ${purged} expired documents`);
  return { expired: expiredDocs.length, purged };
}

/**
 * Get documents expiring soon.
 * Returns documents that will expire within the given hours.
 */
export async function getDocumentsExpiringSoon(
  hours: number = 24
): Promise<Array<{
  id: string;
  name: string;
  expiresAt: Date | null;
  senderBranchId: string;
  recipientBranchId: string;
}>> {
  const threshold = new Date(Date.now() + hours * 60 * 60 * 1000);

  return db.document.findMany({
    where: {
      expiresAt: { lte: threshold, gt: new Date() },
      status: { not: "PURGED" },
    },
    select: {
      id: true,
      name: true,
      expiresAt: true,
      senderBranchId: true,
      recipientBranchId: true,
    },
    orderBy: { expiresAt: "asc" },
  });
}
