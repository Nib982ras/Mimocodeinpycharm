import { NextResponse } from "next/server";
import { requireUser, authErrorResponse } from "@/lib/auth";
import {
  getDocumentPermissions,
  grantDocumentPermission,
  revokeDocumentPermission,
  checkDocumentPermission,
  type PermissionLevel,
} from "@/lib/document-permissions";
import { recordAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

/**
 * GET /api/documents/[id]/permissions
 *
 * List all active permissions for a document.
 * Requires ADMIN permission on the document.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireUser();
    const { id } = await params;

    // Check if user has ADMIN permission
    const hasAdmin = await checkDocumentPermission(id, {
      userId: session.id,
      branchId: session.branchId,
      role: session.role,
      requiredPermission: "ADMIN",
    });

    if (!hasAdmin) {
      return NextResponse.json(
        { ok: false, error: "Insufficient permissions" },
        { status: 403 }
      );
    }

    const permissions = await getDocumentPermissions(id);

    return NextResponse.json({ ok: true, permissions });
  } catch (err) {
    const r = authErrorResponse(err);
    return r ?? NextResponse.json({ ok: false, error: "Failed to list permissions" }, { status: 500 });
  }
}

/**
 * POST /api/documents/[id]/permissions
 *
 * Grant a permission to a user or branch.
 * Requires ADMIN permission on the document.
 *
 * Body:
 *   - userId?: string - User to grant permission to
 *   - branchId?: string - Branch to grant permission to
 *   - permission: "VIEW" | "DOWNLOAD" | "DECRYPT" | "ADMIN"
 *   - expiresAt?: string - Optional expiry date (ISO 8601)
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireUser();
    const { id } = await params;
    const body = await req.json();

    const { userId, branchId, permission, expiresAt } = body as {
      userId?: string;
      branchId?: string;
      permission: PermissionLevel;
      expiresAt?: string;
    };

    // Validate permission level
    const validPermissions = ["VIEW", "DOWNLOAD", "DECRYPT", "ADMIN"];
    if (!validPermissions.includes(permission)) {
      return NextResponse.json(
        { ok: false, error: "Invalid permission level" },
        { status: 400 }
      );
    }

    // Must specify either userId or branchId
    if (!userId && !branchId) {
      return NextResponse.json(
        { ok: false, error: "Must specify either userId or branchId" },
        { status: 400 }
      );
    }

    const granted = await grantDocumentPermission(id, {
      userId,
      branchId,
      permission,
      grantedBy: session.username,
      expiresAt: expiresAt ? new Date(expiresAt) : undefined,
    });

    await recordAudit({
      action: "DOCUMENT_PERMISSION_GRANT",
      actor: session.username,
      actorId: session.id,
      documentId: id,
      status: "SUCCESS",
      details: {
        grantedTo: userId || `branch:${branchId}`,
        permission,
        expiresAt,
      },
      ipAddress: req.headers.get("x-forwarded-for") || undefined,
    });

    return NextResponse.json({ ok: true, permission: granted });
  } catch (err) {
    const r = authErrorResponse(err);
    return r ?? NextResponse.json({ ok: false, error: "Failed to grant permission" }, { status: 500 });
  }
}

/**
 * DELETE /api/documents/[id]/permissions
 *
 * Revoke a permission grant.
 * Requires ADMIN permission on the document.
 *
 * Body:
 *   - permissionId: string - ID of the permission to revoke
 */
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireUser();
    const { id } = await params;
    const body = await req.json();

    const { permissionId } = body as { permissionId: string };

    if (!permissionId) {
      return NextResponse.json(
        { ok: false, error: "permissionId is required" },
        { status: 400 }
      );
    }

    // Check if user has ADMIN permission
    const hasAdmin = await checkDocumentPermission(id, {
      userId: session.id,
      branchId: session.branchId,
      role: session.role,
      requiredPermission: "ADMIN",
    });

    if (!hasAdmin) {
      return NextResponse.json(
        { ok: false, error: "Insufficient permissions" },
        { status: 403 }
      );
    }

    const revoked = await revokeDocumentPermission(permissionId);

    if (!revoked) {
      return NextResponse.json(
        { ok: false, error: "Permission not found" },
        { status: 404 }
      );
    }

    await recordAudit({
      action: "DOCUMENT_PERMISSION_REVOKE",
      actor: session.username,
      actorId: session.id,
      documentId: id,
      status: "SUCCESS",
      details: { permissionId },
      ipAddress: req.headers.get("x-forwarded-for") || undefined,
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    const r = authErrorResponse(err);
    return r ?? NextResponse.json({ ok: false, error: "Failed to revoke permission" }, { status: 500 });
  }
}
