import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  requireUser,
  requireSecurityAdmin,
  ROLE_RANK,
  authErrorResponse,
  AuthError,
} from "@/lib/auth";
import { recordAudit, clientIp } from "@/lib/audit";

export const dynamic = "force-dynamic";

/**
 * POST /api/2fa/disable — turn off 2FA for a user.
 *
 * - A user can disable their own 2FA.
 * - SECURITY_ADMIN (and above) can disable 2FA for any user via `{ userId }`.
 *
 * Revokes any active sessions for the target user so they re-authenticate with
 * the new (lower) factor requirements.
 *
 * Body: `{ userId?: string }`.
 */
export async function POST(req: Request) {
  try {
    const me = await requireUser();
    const body = await req.json().catch(() => ({}));
    const { userId } = body as { userId?: string };

    let targetId = me.id;
    let targetUsername = me.username;
    let isSelf = true;

    if (userId && userId !== me.id) {
      // Cross-user disable requires SECURITY_ADMIN+.
      if (ROLE_RANK[me.role] < ROLE_RANK.SECURITY_ADMIN) {
        throw new AuthError("SECURITY_ADMIN access required to disable another user's 2FA", 403);
      }
      const target = await db.user.findUnique({
        where: { id: userId },
        select: { id: true, username: true, role: true },
      });
      if (!target) {
        return NextResponse.json({ ok: false, error: "User not found" }, { status: 404 });
      }
      // A SECURITY_ADMIN cannot disable 2FA for an OWNER or another SECURITY_ADMIN.
      if (ROLE_RANK[target.role] >= ROLE_RANK[me.role] && target.role !== me.role) {
        throw new AuthError("You cannot disable 2FA for a peer or higher-privileged user", 403);
      }
      if (ROLE_RANK[target.role] > ROLE_RANK[me.role]) {
        throw new AuthError("You cannot disable 2FA for a higher-privileged user", 403);
      }
      targetId = target.id;
      targetUsername = target.username;
      isSelf = false;
    }

    // Require explicit consent via requireSecurityAdmin for the cross-user path
    // (already validated above). For self-disable, requireUser is enough.
    if (!isSelf) {
      await requireSecurityAdmin();
    }

    const existing = await db.twoFactor.findUnique({ where: { userId: targetId } });
    if (!existing) {
      return NextResponse.json(
        { ok: false, error: "2FA is not configured for this account" },
        { status: 404 }
      );
    }

    await db.twoFactor.delete({ where: { userId: targetId } });

    // Burn any active sessions so the user must re-authenticate.
    await db.session.updateMany({
      where: { userId: targetId, revoked: false },
      data: { revoked: true, revokedAt: new Date() },
    });

    await recordAudit({
      action: "2FA_DISABLE",
      actor: me.username,
      actorId: me.id,
      status: "SUCCESS",
      details: { target: targetUsername, self: isSelf },
      ipAddress: clientIp(req),
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    const r = authErrorResponse(err);
    return r ?? NextResponse.json({ ok: false, error: "Failed to disable 2FA" }, { status: 500 });
  }
}
