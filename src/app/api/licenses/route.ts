import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireSecurityAdmin, authErrorResponse } from "@/lib/auth";
import { recordAudit, clientIp } from "@/lib/audit";
import {
  generateLicenseKey,
  signLicense,
  getLicensingFingerprint,
  type LicensePayload,
} from "@/lib/licensing";
import { parsePagination, buildIdCursorWhere, simplePaginatedResponse } from "@/lib/pagination";

export const dynamic = "force-dynamic";

/** GET /api/licenses — paginated list of licenses (SECURITY_ADMIN+).
 *  Query params: cursor, limit (default 50, max 200), status, tier
 */
export async function GET(req: Request) {
  try {
    const me = await requireSecurityAdmin();
    const url = new URL(req.url);
    const pagination = parsePagination(url);
    const statusFilter = url.searchParams.get("status");
    const tierFilter = url.searchParams.get("tier");

    const where: Record<string, unknown> = {};
    if (statusFilter) where.status = statusFilter;
    if (tierFilter) where.tier = tierFilter;

    const paginatedWhere = buildIdCursorWhere(where, pagination);

    const licenses = await db.license.findMany({
      where: paginatedWhere,
      orderBy: { issuedAt: "desc" },
      take: pagination.limit + 1,
      include: {
        device: {
          select: {
            id: true,
            name: true,
            fingerprint: true,
            status: true,
            user: {
              select: { id: true, username: true, displayName: true, role: true },
            },
          },
        },
      },
    });

    const result = simplePaginatedResponse(licenses, pagination, undefined, (l) => ({
      id: l.id,
      licenseKey: l.licenseKey,
      status: l.status,
      tier: l.tier,
      issuedAt: l.issuedAt.toISOString(),
      expiresAt: l.expiresAt.toISOString(),
      revokedAt: l.revokedAt?.toISOString() ?? null,
      revokedBy: l.revokedBy,
      revokeReason: l.revokeReason,
      signerFingerprint: l.signerFingerprint,
      device: l.device
        ? {
            id: l.device.id,
            name: l.device.name,
            fingerprint: l.device.fingerprint,
            status: l.device.status,
            owner: l.device.user,
          }
        : null,
    }));

    return NextResponse.json({ ok: true, actor: me.username, licenses: result.data, pagination: result.pagination });
  } catch (err) {
    const r = authErrorResponse(err);
    return r ?? NextResponse.json({ ok: false, error: "Failed to list licenses" }, { status: 500 });
  }
}

/**
 * POST /api/licenses — issue a new cryptographically signed license for a device.
 *
 * Body: `{ deviceId: string, tier?: string, expiresInDays: number }`.
 *
 * The payload `{ deviceId, deviceFingerprint, tier, issuedAt, expiresAt }` is
 * signed with the system's ECDSA-P521-SHA512 licensing key; the signature is
 * stored alongside the license so offline validation can re-verify it without
 * trusting the DB row.
 */
export async function POST(req: Request) {
  try {
    const me = await requireSecurityAdmin();
    const body = await req.json().catch(() => ({}));
    const { deviceId, tier, expiresInDays } = body as {
      deviceId?: string;
      tier?: string;
      expiresInDays?: number;
    };

    if (!deviceId || !expiresInDays || expiresInDays <= 0) {
      return NextResponse.json(
        { ok: false, error: "deviceId and a positive expiresInDays are required" },
        { status: 400 }
      );
    }

    const validTiers = ["STANDARD", "ENTERPRISE", "TRIAL"];
    const resolvedTier = validTiers.includes(tier || "") ? tier! : "STANDARD";

    const device = await db.device.findUnique({
      where: { id: deviceId },
      include: { license: true },
    });
    if (!device) {
      return NextResponse.json({ ok: false, error: "Device not found" }, { status: 404 });
    }
    if (device.status === "REVOKED") {
      return NextResponse.json(
        { ok: false, error: "Cannot issue a license for a revoked device" },
        { status: 400 }
      );
    }
    if (device.license) {
      return NextResponse.json(
        { ok: false, error: "Device already has a license. Revoke it first." },
        { status: 409 }
      );
    }

    const issuedAt = Date.now();
    const expiresAt = issuedAt + Math.floor(expiresInDays) * 24 * 60 * 60 * 1000;
    const payload: LicensePayload = {
      deviceId: device.id,
      deviceFingerprint: device.fingerprint,
      tier: resolvedTier,
      issuedAt,
      expiresAt,
    };
    const signature = signLicense(payload);
    const licenseKey = generateLicenseKey();
    const signerFingerprint = getLicensingFingerprint();

    const license = await db.license.create({
      data: {
        deviceId: device.id,
        licenseKey,
        status: "ACTIVE",
        tier: resolvedTier,
        issuedAt: new Date(issuedAt),
        expiresAt: new Date(expiresAt),
        signature,
        signerFingerprint,
      },
    });

    await recordAudit({
      action: "LICENSE_ISSUE",
      actor: me.username,
      actorId: me.id,
      status: "SUCCESS",
      details: {
        licenseId: license.id,
        licenseKey,
        deviceId: device.id,
        deviceName: device.name,
        tier: resolvedTier,
        expiresAt,
      },
      ipAddress: clientIp(req),
    });

    return NextResponse.json({
      ok: true,
      license: {
        id: license.id,
        licenseKey: license.licenseKey,
        status: license.status,
        tier: license.tier,
        issuedAt: license.issuedAt.toISOString(),
        expiresAt: license.expiresAt.toISOString(),
        signature,
        signerFingerprint,
        deviceId: device.id,
        deviceName: device.name,
        deviceFingerprint: device.fingerprint,
      },
    });
  } catch (err) {
    const r = authErrorResponse(err);
    return r ?? NextResponse.json({ ok: false, error: "Failed to issue license" }, { status: 500 });
  }
}
