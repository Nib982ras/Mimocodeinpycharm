import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireOwner, authErrorResponse, getSystemState } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

/** POST /api/system/activate — re-activate the system (owner only). */
export async function POST(req: Request) {
  try {
    const owner = await requireOwner();
    await db.systemState.update({
      where: { id: "singleton" },
      data: { active: true },
    });
    await recordAudit({
      action: "SYSTEM_ACTIVATE",
      actor: owner.username,
      actorId: owner.id,
      status: "SUCCESS",
      details: { event: "SYSTEM_ACTIVATED" },
      ipAddress: req.headers.get("x-forwarded-for") || undefined,
    });
    return NextResponse.json({ ok: true, active: true });
  } catch (err) {
    const r = authErrorResponse(err);
    return r ?? NextResponse.json({ ok: false, error: "Failed to activate system" }, { status: 500 });
  }
}
