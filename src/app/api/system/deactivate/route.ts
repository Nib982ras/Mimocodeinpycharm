import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireOwner, authErrorResponse } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

/**
 * POST /api/system/deactivate — deactivate the entire system (owner only).
 * All non-owner logins and document transfers are blocked until re-activated.
 * Existing sessions are NOT destroyed (users keep their cookies) but every
 * API guarded by requireSystemActive() will reject them. The owner retains
 * full access to re-activate or trigger a full lockdown.
 */
export async function POST(req: Request) {
  try {
    const owner = await requireOwner();
    const body = await req.json().catch(() => ({}));
    const reason = (body as { reason?: string })?.reason || "No reason provided";

    await db.systemState.update({
      where: { id: "singleton" },
      data: { active: false },
    });

    await recordAudit({
      action: "SYSTEM_DEACTIVATE",
      actor: owner.username,
      actorId: owner.id,
      status: "SUCCESS",
      details: { event: "SYSTEM_DEACTIVATED", reason },
      ipAddress: req.headers.get("x-forwarded-for") || undefined,
    });

    return NextResponse.json({ ok: true, active: false, reason });
  } catch (err) {
    const r = authErrorResponse(err);
    return r ?? NextResponse.json({ ok: false, error: "Failed to deactivate system" }, { status: 500 });
  }
}
