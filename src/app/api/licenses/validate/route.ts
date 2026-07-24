import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireUser, authErrorResponse } from "@/lib/auth";
import { recordAudit, clientIp } from "@/lib/audit";
import { isLicenseValid, type LicensePayload } from "@/lib/licensing";

export const dynamic = "force-dynamic";

/**
 * POST /api/licenses/validate — validate a license for a given device.
 *
 * Body: `{ licenseKey: string, deviceFingerprint: string }`.
 *
 * Reconstructs the signed payload from the stored license fields, verifies the
 * ECDSA-P521 signature with the system's licensing public key, and checks
 * expiry/status. The audit trail records both SUCCESS and FAILURE outcomes
 * with the rejection reason so admins can spot abuse.
 *
 * The device's lastSeenAt / lastSeenIp are updated on every call (even
 * failures) to give admins visibility into attempted use.
 */
export async function POST(req: Request) {
  try {
    const me = await requireUser();
    const body = await req.json().catch(() => ({}));
    const { licenseKey, deviceFingerprint } = body as {
      licenseKey?: string;
      deviceFingerprint?: string;
    };

    if (!licenseKey || !deviceFingerprint) {
      return NextResponse.json(
        { ok: false, error: "licenseKey and deviceFingerprint are required" },
        { status: 400 }
      );
    }

    const ip = clientIp(req);
    const now = new Date();

    const license = await db.license.findUnique({
      where: { licenseKey },
      include: { device: true },
    });

    if (!license) {
      await recordAudit({
        action: "LICENSE_VALIDATE",
        actor: me.username,
        actorId: me.id,
        status: "FAILURE",
        details: { reason: "NOT_FOUND", licenseKey },
        ipAddress: ip,
      });
      return NextResponse.json({ ok: false, error: "License not found" }, { status: 404 });
    }

    // Always update device lastSeen — even on failures — for observability.
    if (license.device) {
      await db.device.update({
        where: { id: license.device.id },
        data: { lastSeenAt: now, lastSeenIp: ip ?? null },
      });
    }

    const payload: LicensePayload = {
      deviceId: license.deviceId,
      deviceFingerprint: license.device?.fingerprint ?? "",
      tier: license.tier,
      issuedAt: license.issuedAt.getTime(),
      expiresAt: license.expiresAt.getTime(),
    };

    // Fingerprint mismatch is a hard fail — license is bound to a different key.
    if (license.device && license.device.fingerprint !== deviceFingerprint) {
      await recordAudit({
        action: "LICENSE_VALIDATE",
        actor: me.username,
        actorId: me.id,
        status: "FAILURE",
        details: {
          reason: "FINGERPRINT_MISMATCH",
          licenseKey,
          expected: license.device.fingerprint,
          received: deviceFingerprint,
        },
        ipAddress: ip,
      });
      return NextResponse.json({
        ok: false,
        valid: false,
        reason: "Device fingerprint does not match license",
        license: {
          id: license.id,
          licenseKey: license.licenseKey,
          status: license.status,
          tier: license.tier,
          expiresAt: license.expiresAt.toISOString(),
        },
      });
    }

    const result = isLicenseValid(payload, license.signature, license.status);

    await recordAudit({
      action: "LICENSE_VALIDATE",
      actor: me.username,
      actorId: me.id,
      status: result.valid ? "SUCCESS" : "FAILURE",
      details: {
        reason: result.valid ? "VALID" : result.reason,
        licenseKey,
        deviceId: license.deviceId,
      },
      ipAddress: ip,
    });

    return NextResponse.json({
      ok: result.valid,
      valid: result.valid,
      reason: result.reason,
      license: {
        id: license.id,
        licenseKey: license.licenseKey,
        status: license.status,
        tier: license.tier,
        issuedAt: license.issuedAt.toISOString(),
        expiresAt: license.expiresAt.toISOString(),
        signerFingerprint: license.signerFingerprint,
        deviceId: license.deviceId,
        deviceName: license.device?.name ?? null,
        deviceFingerprint: license.device?.fingerprint ?? null,
      },
    });
  } catch (err) {
    const r = authErrorResponse(err);
    return r ?? NextResponse.json({ ok: false, error: "Failed to validate license" }, { status: 500 });
  }
}
