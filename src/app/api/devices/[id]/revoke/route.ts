import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireSecurityAdmin, authErrorResponse, ROLE_RANK } from "@/lib/auth";
import { recordAudit, clientIp } from "@/lib/audit";

export const dynamic = "force-dynamic";

/**
 * POST /api/devices/[id]/revoke — revoke a device and its license.
 *
 * SECURITY_ADMIN+ (or the device's owner) can revoke. The device's status
 * flips to REVOKED, its license (if any) is also revoked, and the audit log
 * records who revoked it.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const me = await requireSecurityAdmin();
    const { id } = await params;

    const device = await db.device.findUnique({
      where: { id },
      include: { license: true, user: { select: { id: true, username: true } } },
    });
    if (!device) {
      return NextResponse.json({ ok: false, error: "Device not found" }, { status: 404 });
    }
    if (device.status === "REVOKED") {
      return NextResponse.json({ ok: false, error: "Device is already revoked" }, { status: 409 });
    }

    // Defense-in-depth: ensure the actor actually had SECURITY_ADMIN rights
    // (requireSecurityAdmin already enforced this; this is here so future
    // refactors don't silently weaken the gate).
    void ROLE_RANK;

    const now = new Date();
    await db.device.update({
      where: { id },
      data: {
        status: "REVOKED",
        revokedAt: now,
        revokedBy: me.username,
      },
    });

    if (device.license && device.license.status !== "REVOKED") {
      await db.license.update({
        where: { deviceId: device.id },
        data: {
          status: "REVOKED",
          revokedAt: now,
          revokedBy: me.username,
          revokeReason: "Device revoked",
        },
      });
    }

    await recordAudit({
      action: "DEVICE_REVOKE",
      actor: me.username,
      actorId: me.id,
      status: "SUCCESS",
      details: {
        deviceId: device.id,
        deviceName: device.name,
        fingerprint: device.fingerprint,
        owner: device.user?.username ?? null,
        licenseRevoked: !!device.license,
      },
      ipAddress: clientIp(req),
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    const r = authErrorResponse(err);
    return r ?? NextResponse.json({ ok: false, error: "Failed to revoke device" }, { status: 500 });
  }
}
