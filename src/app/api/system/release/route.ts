import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireOwner, authErrorResponse } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

/** POST /api/system/release — release emergency lockdown (owner only). */
export async function POST(req: Request) {
  try {
    const owner = await requireOwner();
    const prev = await db.systemState.findUnique({ where: { id: "singleton" } });

    await db.systemState.update({
      where: { id: "singleton" },
      data: {
        lockdown: false,
        lockdownReason: null,
        lockedBy: null,
        lockedAt: null,
      },
    });

    await recordAudit({
      action: "LOCKDOWN_RELEASE",
      actor: owner.username,
      actorId: owner.id,
      status: "SUCCESS",
      details: {
        event: "LOCKDOWN_RELEASED",
        previousReason: prev?.lockdownReason ?? null,
        wasLockedBy: prev?.lockedBy ?? null,
      },
      ipAddress: req.headers.get("x-forwarded-for") || undefined,
    });

    return NextResponse.json({ ok: true, lockdown: false });
  } catch (err) {
    const r = authErrorResponse(err);
    return r ?? NextResponse.json({ ok: false, error: "Failed to release lockdown" }, { status: 500 });
  }
}
