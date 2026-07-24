import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireSecurityAdmin, authErrorResponse, ROLE_RANK } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

/**
 * POST /api/users/[id]/suspend — suspend or reactivate a user account.
 * SECURITY_ADMIN+ can suspend any non-OWNER account. Suspending revokes all
 * the user's active sessions so their cookies become invalid immediately.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const admin = await requireSecurityAdmin();
    const { id } = await params;
    const body = await req.json().catch(() => ({}));
    const { suspend, reason } = body as { suspend?: boolean; reason?: string };

    const target = await db.user.findUnique({ where: { id } });
    if (!target) {
      return NextResponse.json({ ok: false, error: "User not found" }, { status: 404 });
    }
    // Cannot suspend owners, and cannot suspend someone with equal/higher rank
    // unless you're the owner.
    if (target.role === "OWNER") {
      return NextResponse.json({ ok: false, error: "Cannot suspend the system owner" }, { status: 400 });
    }
    if (ROLE_RANK[target.role] >= ROLE_RANK[admin.role] && admin.role !== "OWNER") {
      return NextResponse.json({ ok: false, error: "Cannot suspend a user of equal or higher rank" }, { status: 403 });
    }

    if (suspend) {
      await db.user.update({
        where: { id },
        data: {
          status: "SUSPENDED",
          suspendedReason: reason || "Suspended by administrator",
          suspendedAt: new Date(),
          suspendedBy: admin.username,
        },
      });
      // Revoke all their active sessions.
      await db.session.updateMany({
        where: { userId: id, revoked: false },
        data: { revoked: true, revokedAt: new Date() },
      });
      await recordAudit({
        action: "USER_SUSPEND",
        actor: admin.username,
        actorId: admin.id,
        status: "SUCCESS",
        details: { target: target.username, targetRole: target.role, reason: reason || null },
        ipAddress: req.headers.get("x-forwarded-for") || undefined,
      });
      return NextResponse.json({ ok: true, status: "SUSPENDED" });
    } else {
      await db.user.update({
        where: { id },
        data: {
          status: "ACTIVE",
          suspendedReason: null,
          suspendedAt: null,
          suspendedBy: null,
        },
      });
      await recordAudit({
        action: "USER_REACTIVATE",
        actor: admin.username,
        actorId: admin.id,
        status: "SUCCESS",
        details: { target: target.username },
      });
      return NextResponse.json({ ok: true, status: "ACTIVE" });
    }
  } catch (err) {
    const r = authErrorResponse(err);
    return r ?? NextResponse.json({ ok: false, error: "Failed to update user status" }, { status: 500 });
  }
}
