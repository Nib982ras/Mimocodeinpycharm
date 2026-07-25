import { db } from "@/lib/db";

/**
 * Document permissions service.
 *
 * Provides granular access control for documents beyond the basic
 * sender/recipient branch model. Supports:
 *   - Per-user permissions
 *   - Per-branch permissions
 *   - Role-based permissions
 *   - Time-limited permissions (auto-expire)
 *   - Permission hierarchy (ADMIN > DECRYPT > DOWNLOAD > VIEW)
 */

// ---------- Types ----------

export type PermissionLevel = "VIEW" | "DOWNLOAD" | "DECRYPT" | "ADMIN";

/** Permission hierarchy for comparison (higher = more access) */
const PERMISSION_HIERARCHY: Record<PermissionLevel, number> = {
  VIEW: 1,
  DOWNLOAD: 2,
  DECRYPT: 3,
  ADMIN: 4,
};

export interface DocumentPermissionEntry {
  id: string;
  documentId: string;
  userId?: string | null;
  branchId?: string | null;
  permission: PermissionLevel;
  grantedBy: string;
  grantedAt: Date;
  expiresAt?: Date | null;
  revokedAt?: Date | null;
}

export interface CheckPermissionOptions {
  /** User ID to check */
  userId?: string;
  /** User's branch ID */
  branchId?: string | null;
  /** User's role */
  role?: string;
  /** Required permission level */
  requiredPermission: PermissionLevel;
}

// ---------- Permission checking ----------

/**
 * Check if a user has the required permission for a document.
 *
 * Access is granted if ANY of the following are true:
 *   1. User is OWNER or SECURITY_ADMIN (full access)
 *   2. User is sender branch BRANCH_ADMIN or above
 *   3. User is recipient branch member (for basic access)
 *   4. User has an explicit DocumentPermission grant
 *   5. User's branch has an explicit DocumentPermission grant
 *
 * @param documentId - The document to check
 * @param options - User context and required permission
 * @returns true if access is granted
 */
export async function checkDocumentPermission(
  documentId: string,
  options: CheckPermissionOptions
): Promise<boolean> {
  const { userId, branchId, role, requiredPermission } = options;

  // Admin roles always have access
  if (role === "OWNER" || role === "SECURITY_ADMIN") {
    return true;
  }

  // Fetch the document
  const doc = await db.document.findUnique({
    where: { id: documentId },
    select: {
      id: true,
      senderBranchId: true,
      recipientBranchId: true,
      visibility: true,
    },
  });

  if (!doc) return false;

  // Check branch-based access
  if (branchId) {
    // Sender branch members can access
    if (doc.senderBranchId === branchId) {
      return true;
    }

    // Recipient branch members can access (except READONLY for DECRYPT)
    if (doc.recipientBranchId === branchId) {
      if (requiredPermission === "DECRYPT" && role === "READONLY") {
        return false;
      }
      return true;
    }
  }

  // For restricted/shared documents, check explicit permissions
  if (doc.visibility === "restricted" || doc.visibility === "shared") {
    const hasPermission = await hasExplicitPermission(documentId, userId, branchId, requiredPermission);
    if (hasPermission) return true;
  }

  return false;
}

/**
 * Check if a user or branch has an explicit permission grant.
 */
async function hasExplicitPermission(
  documentId: string,
  userId?: string,
  branchId?: string | null,
  requiredPermission?: PermissionLevel
): Promise<boolean> {
  const where: any = {
    documentId,
    revokedAt: null,
    OR: [],
  };

  // Check user-specific permissions
  if (userId) {
    where.OR.push({ userId });
  }

  // Check branch-specific permissions
  if (branchId) {
    where.OR.push({ branchId });
  }

  if (where.OR.length === 0) return false;

  const permissions = await db.documentPermission.findMany({
    where: {
      ...where,
      // Check expiry
      OR: [
        { expiresAt: null },
        { expiresAt: { gt: new Date() } },
      ],
    },
  });

  if (permissions.length === 0) return false;

  // If no specific permission required, any grant is sufficient
  if (!requiredPermission) return true;

  // Check if any granted permission meets the requirement
  const requiredLevel = PERMISSION_HIERARCHY[requiredPermission];
  return permissions.some(
    (p) => PERMISSION_HIERARCHY[p.permission as PermissionLevel] >= requiredLevel
  );
}

// ---------- Permission management ----------

/**
 * Grant a permission to a user for a document.
 */
export async function grantDocumentPermission(
  documentId: string,
  options: {
    userId?: string;
    branchId?: string;
    permission: PermissionLevel;
    grantedBy: string;
    expiresAt?: Date;
  }
): Promise<DocumentPermissionEntry> {
  const { userId, branchId, permission, grantedBy, expiresAt } = options;

  // Validate: must specify either userId or branchId
  if (!userId && !branchId) {
    throw new Error("Must specify either userId or branchId");
  }

  // Check if grantor has ADMIN permission
  const grantorHasAdmin = await checkDocumentPermission(documentId, {
    requiredPermission: "ADMIN",
  });

  if (!grantorHasAdmin) {
    throw new Error("Only users with ADMIN permission can grant access");
  }

  // Create or update the permission
  const existing = await db.documentPermission.findFirst({
    where: {
      documentId,
      userId: userId || null,
      branchId: branchId || null,
    },
  });

  if (existing) {
    // Update existing permission
    const updated = await db.documentPermission.update({
      where: { id: existing.id },
      data: {
        permission,
        grantedBy,
        grantedAt: new Date(),
        expiresAt: expiresAt || null,
        revokedAt: null,
      },
    });
    return updated as DocumentPermissionEntry;
  }

  // Create new permission
  const created = await db.documentPermission.create({
    data: {
      documentId,
      userId: userId || null,
      branchId: branchId || null,
      permission,
      grantedBy,
      expiresAt: expiresAt || null,
    },
  });

  return created as DocumentPermissionEntry;
}

/**
 * Revoke a permission grant.
 */
export async function revokeDocumentPermission(
  permissionId: string
): Promise<boolean> {
  try {
    await db.documentPermission.update({
      where: { id: permissionId },
      data: { revokedAt: new Date() },
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Revoke all permissions for a document.
 */
export async function revokeAllDocumentPermissions(
  documentId: string
): Promise<number> {
  const result = await db.documentPermission.updateMany({
    where: {
      documentId,
      revokedAt: null,
    },
    data: { revokedAt: new Date() },
  });

  return result.count;
}

// ---------- Query helpers ----------

/**
 * Get all active permissions for a document.
 */
export async function getDocumentPermissions(
  documentId: string
): Promise<DocumentPermissionEntry[]> {
  return db.documentPermission.findMany({
    where: {
      documentId,
      revokedAt: null,
      OR: [
        { expiresAt: null },
        { expiresAt: { gt: new Date() } },
      ],
    },
    include: {
      user: { select: { id: true, username: true, displayName: true } },
      branch: { select: { id: true, code: true, name: true } },
    },
    orderBy: { grantedAt: "desc" },
  }) as any;
}

/**
 * Get all documents a user has explicit permission for.
 */
export async function getUserDocumentPermissions(
  userId: string
): Promise<Array<{
  documentId: string;
  permission: PermissionLevel;
  expiresAt: Date | null;
}>> {
  const permissions = await db.documentPermission.findMany({
    where: {
      userId,
      revokedAt: null,
      OR: [
        { expiresAt: null },
        { expiresAt: { gt: new Date() } },
      ],
    },
    select: {
      documentId: true,
      permission: true,
      expiresAt: true,
    },
  });

  return permissions as any;
}

/**
 * Clean up expired permissions.
 */
export async function cleanupExpiredPermissions(): Promise<number> {
  const result = await db.documentPermission.updateMany({
    where: {
      expiresAt: { lt: new Date() },
      revokedAt: null,
    },
    data: { revokedAt: new Date() },
  });

  return result.count;
}

// ---------- Visibility helpers ----------

/**
 * Set document visibility.
 */
export async function setDocumentVisibility(
  documentId: string,
  visibility: "branch" | "restricted" | "shared"
): Promise<void> {
  await db.document.update({
    where: { id: documentId },
    data: { visibility },
  });
}

/**
 * Set document expiry.
 */
export async function setDocumentExpiry(
  documentId: string,
  expiresAt: Date | null
): Promise<void> {
  await db.document.update({
    where: { id: documentId },
    data: { expiresAt },
  });
}
