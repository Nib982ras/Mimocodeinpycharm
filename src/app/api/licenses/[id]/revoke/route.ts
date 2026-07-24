import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireSecurityAdmin, authErrorResponse } from "@/lib/auth";
import { recordAudit, clientIp } from "@/lib/audit";

export const dynamic = "force-dynamic";

/**
 * POST /api/licenses/[id]/revoke — revoke a license (SECURITY_ADMIN+).
 *
 * Body: `{ reason?: string }`. The license status flips to REVOKED; subsequent
 * /api/licenses/validate calls will fail with reason "License revoked".
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const me = await requireSecurityAdmin();
    const { id } = await params;
    const body = await req.json().catch(() => ({}));
    const { reason } = body as { reason?: string };

    const license = await db.license.findUnique({
      where: { id },
      include: { device: { select: { id: true, name: true, fingerprint: true } } },
    });
    if (!license) {
      return NextResponse.json({ ok: false, error: "License not found" }, { status: 404 });
    }
    if (license.status === "REVOKED") {
      return NextResponse.json({ ok: false, error: "License is already revoked" }, { status: 409 });
    }

    await db.license.update({
      where: { id },
      data: {
        status: "REVOKED",
        revokedAt: new Date(),
        revokedBy: me.username,
        revokeReason: reason || "Revoked by administrator",
      },
    });

    await recordAudit({
      action: "LICENSE_REVOKE",
      actor: me.username,
      actorId: me.id,
      status: "SUCCESS",
      details: {
        licenseId: license.id,
        licenseKey: license.licenseKey,
        deviceId: license.device?.id ?? null,
        deviceName: license.device?.name ?? null,
        reason: reason || "Revoked by administrator",
      },
      ipAddress: clientIp(req),
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    const r = authErrorResponse(err);
    return r ?? NextResponse.json({ ok: false, error: "Failed to revoke license" }, { status: 500 });
  }
}
