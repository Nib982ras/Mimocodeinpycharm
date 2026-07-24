import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireUser, authErrorResponse } from "@/lib/auth";
import { recordAudit, clientIp } from "@/lib/audit";
import { verifyTotp } from "@/lib/totp";
import { decryptPrivateKey } from "@/lib/crypto";

export const dynamic = "force-dynamic";

/**
 * POST /api/2fa/verify — confirm 2FA enrollment.
 *
 * The user just called /api/2fa/setup, added the secret to their authenticator
 * app, and now types in a 6-digit code to prove they captured it correctly.
 * On success the `enabled` flag flips to true and `enrolledAt` is set; from
 * this point forward login will require a 2FA factor.
 *
 * Body: `{ code: string }`.
 */
export async function POST(req: Request) {
  try {
    const me = await requireUser();
    const body = await req.json().catch(() => ({}));
    const { code } = body as { code?: string };

    if (!code) {
      return NextResponse.json(
        { ok: false, error: "A 6-digit code is required" },
        { status: 400 }
      );
    }

    const tf = await db.twoFactor.findUnique({ where: { userId: me.id } });
    if (!tf) {
      return NextResponse.json(
        { ok: false, error: "No pending 2FA enrollment. Call /api/2fa/setup first." },
        { status: 400 }
      );
    }
    if (tf.enabled) {
      return NextResponse.json(
        { ok: false, error: "2FA is already enabled for this account" },
        { status: 400 }
      );
    }

    let valid = false;
    try {
      const secret = decryptPrivateKey(tf.encryptedSecret, tf.secretIv);
      valid = verifyTotp(secret, code);
    } catch {
      valid = false;
    }

    if (!valid) {
      await recordAudit({
        action: "2FA_FAIL",
        actor: me.username,
        actorId: me.id,
        status: "FAILURE",
        details: { stage: "ENROLL_VERIFY" },
        ipAddress: clientIp(req),
      });
      return NextResponse.json(
        { ok: false, error: "Invalid 2FA code" },
        { status: 401 }
      );
    }

    await db.twoFactor.update({
      where: { userId: me.id },
      data: { enabled: true, enrolledAt: new Date() },
    });

    await recordAudit({
      action: "2FA_VERIFY",
      actor: me.username,
      actorId: me.id,
      status: "SUCCESS",
      details: { stage: "ENROLL_VERIFY" },
      ipAddress: clientIp(req),
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    const r = authErrorResponse(err);
    return r ?? NextResponse.json({ ok: false, error: "Failed to verify 2FA code" }, { status: 500 });
  }
}
