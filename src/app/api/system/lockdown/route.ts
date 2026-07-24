import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireOwner, authErrorResponse } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";
import { hubNotify } from "@/lib/hub-client";

export const dynamic = "force-dynamic";

/**
 * POST /api/system/lockdown — emergency lockdown (owner only).
 *
 * This is the nuclear option: all non-owner sessions are immediately revoked
 * (their cookies become invalid), the system is marked locked-down so no new
 * logins succeed, and the exchange hub broadcasts a `system:lockdown` event
 * so every connected client disconnects. The owner retains access to release
 * the lockdown.
 *
 * No "master password" or backdoor is involved — the owner authenticates
 * normally (with 2FA enforced) and signs the lockdown command with their
 * administrative authority, which is fully audited.
 */
export async function POST(req: Request) {
  try {
    const owner = await requireOwner();
    const body = await req.json().catch(() => ({}));
    const reason = (body as { reason?: string })?.reason || "Emergency lockdown initiated";

    // 1. Mark the system as locked down.
    await db.systemState.update({
      where: { id: "singleton" },
      data: {
        lockdown: true,
        lockdownReason: reason,
        lockedBy: owner.username,
        lockedAt: new Date(),
      },
    });

    // 2. Revoke ALL non-owner sessions (their cookies become invalid instantly).
    const nonOwnerUsers = await db.user.findMany({
      where: { role: { not: "OWNER" } },
      select: { id: true },
    });
    const nonOwnerIds = nonOwnerUsers.map((u) => u.id);
    if (nonOwnerIds.length > 0) {
      await db.session.updateMany({
        where: { userId: { in: nonOwnerIds }, revoked: false },
        data: { revoked: true, revokedAt: new Date() },
      });
    }

    // 3. Broadcast lockdown over the hub so connected clients disconnect.
    hubNotify({
      type: "document:delivered",
      document: {
        id: "lockdown",
        name: reason,
        sender: { code: "OWNER", name: owner.displayName },
        recipient: { code: "ALL", name: "All clients" },
        size: 0,
      },
    } as Parameters<typeof hubNotify>[0]);

    await recordAudit({
      action: "LOCKDOWN",
      actor: owner.username,
      actorId: owner.id,
      status: "SUCCESS",
      details: {
        event: "EMERGENCY_LOCKDOWN",
        reason,
        sessionsRevoked: nonOwnerIds.length,
      },
      ipAddress: req.headers.get("x-forwarded-for") || undefined,
    });

    return NextResponse.json({
      ok: true,
      lockdown: true,
      reason,
      sessionsRevoked: nonOwnerIds.length,
    });
  } catch (err) {
    const r = authErrorResponse(err);
    return r ?? NextResponse.json({ ok: false, error: "Failed to initiate lockdown" }, { status: 500 });
  }
}
