import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireUser, authErrorResponse, ROLE_RANK } from "@/lib/auth";
import { recordAudit, clientIp } from "@/lib/audit";
import { sha256Hex } from "@/lib/crypto";

export const dynamic = "force-dynamic";

/**
 * GET /api/devices — list devices.
 *
 * - Regular users see only their own devices.
 * - SECURITY_ADMIN+ sees every device (with the owning user resolved).
 */
export async function GET() {
  try {
    const me = await requireUser();
    const isAdmin = ROLE_RANK[me.role] >= ROLE_RANK.SECURITY_ADMIN;

    const devices = await db.device.findMany({
      where: isAdmin ? undefined : { userId: me.id },
      orderBy: { createdAt: "desc" },
      include: isAdmin
        ? {
            user: {
              select: {
                id: true,
                username: true,
                displayName: true,
                role: true,
                branch: { select: { id: true, code: true, name: true } },
              },
            },
            license: { select: { id: true, status: true, tier: true, expiresAt: true, licenseKey: true } },
          }
        : {
            license: { select: { id: true, status: true, tier: true, expiresAt: true, licenseKey: true } },
          },
    });

    return NextResponse.json({
      ok: true,
      actor: me.username,
      admin: isAdmin,
      devices: devices.map((d) => ({
        id: d.id,
        name: d.name,
        fingerprint: d.fingerprint,
        publicKeyPem: d.publicKeyPem,
        status: d.status,
        lastSeenAt: d.lastSeenAt?.toISOString() ?? null,
        lastSeenIp: d.lastSeenIp,
        createdAt: d.createdAt.toISOString(),
        revokedAt: d.revokedAt?.toISOString() ?? null,
        revokedBy: d.revokedBy,
        userId: d.userId,
        user: "user" in d ? d.user : undefined,
        license: d.license
          ? {
              id: d.license.id,
              status: d.license.status,
              tier: d.license.tier,
              expiresAt: d.license.expiresAt.toISOString(),
              licenseKey: d.license.licenseKey,
            }
          : null,
      })),
    });
  } catch (err) {
    const r = authErrorResponse(err);
    return r ?? NextResponse.json({ ok: false, error: "Failed to list devices" }, { status: 500 });
  }
}

/**
 * POST /api/devices — register a new device for the current user.
 *
 * Body: `{ name: string, publicKeyPem: string }`. The public key is hashed to
 * derive the device fingerprint (SHA-256). The fingerprint is unique, so a
 * re-registration of the same key collides at the DB layer (409).
 */
export async function POST(req: Request) {
  try {
    const me = await requireUser();
    const body = await req.json().catch(() => ({}));
    const { name, publicKeyPem } = body as { name?: string; publicKeyPem?: string };

    if (!name || !publicKeyPem) {
      return NextResponse.json(
        { ok: false, error: "name and publicKeyPem are required" },
        { status: 400 }
      );
    }
    if (!/-----BEGIN PUBLIC KEY-----/.test(publicKeyPem)) {
      return NextResponse.json(
        { ok: false, error: "publicKeyPem must be a PEM-encoded public key" },
        { status: 400 }
      );
    }

    const fingerprint = sha256Hex(publicKeyPem);

    const existing = await db.device.findUnique({ where: { fingerprint } });
    if (existing) {
      return NextResponse.json(
        { ok: false, error: "A device with this public key is already registered" },
        { status: 409 }
      );
    }

    const device = await db.device.create({
      data: {
        userId: me.id,
        name,
        fingerprint,
        publicKeyPem,
        status: "ACTIVE",
        lastSeenIp: clientIp(req) ?? null,
        lastSeenAt: new Date(),
      },
    });

    await recordAudit({
      action: "DEVICE_REGISTER",
      actor: me.username,
      actorId: me.id,
      status: "SUCCESS",
      details: {
        deviceId: device.id,
        deviceName: device.name,
        fingerprint,
      },
      ipAddress: clientIp(req),
    });

    return NextResponse.json({
      ok: true,
      device: {
        id: device.id,
        name: device.name,
        fingerprint: device.fingerprint,
        publicKeyPem: device.publicKeyPem,
        status: device.status,
        lastSeenAt: device.lastSeenAt?.toISOString() ?? null,
        lastSeenIp: device.lastSeenIp,
        createdAt: device.createdAt.toISOString(),
        userId: device.userId,
      },
    });
  } catch (err) {
    const r = authErrorResponse(err);
    return r ?? NextResponse.json({ ok: false, error: "Failed to register device" }, { status: 500 });
  }
}
