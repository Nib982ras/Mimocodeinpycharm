import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireUser, authErrorResponse, getSystemState, ROLE_RANK } from "@/lib/auth";
import { getLicensingPublicKey, getLicensingFingerprint } from "@/lib/licensing";

export const dynamic = "force-dynamic";

/** GET /api/system/state — current system status (any authenticated user). */
export async function GET() {
  try {
    await requireUser();
    const state = await getSystemState();
    const counts = {
      users: await db.user.count(),
      activeUsers: await db.user.count({ where: { status: "ACTIVE" } }),
      suspendedUsers: await db.user.count({ where: { status: "SUSPENDED" } }),
      devices: await db.device.count(),
      activeDevices: await db.device.count({ where: { status: "ACTIVE" } }),
      revokedDevices: await db.device.count({ where: { status: "REVOKED" } }),
      licenses: await db.license.count(),
      activeLicenses: await db.license.count({ where: { status: "ACTIVE" } }),
      revokedLicenses: await db.license.count({ where: { status: "REVOKED" } }),
    };
    return NextResponse.json({
      ok: true,
      state: {
        active: state.active,
        lockdown: state.lockdown,
        lockdownReason: state.lockdownReason,
        lockedBy: state.lockedBy,
        lockedAt: state.lockedAt?.toISOString() ?? null,
      },
      counts,
      licensing: {
        publicKey: getLicensingPublicKey(),
        fingerprint: getLicensingFingerprint(),
      },
    });
  } catch (err) {
    const r = authErrorResponse(err);
    return r ?? NextResponse.json({ ok: false, error: "Failed to load system state" }, { status: 500 });
  }
}
