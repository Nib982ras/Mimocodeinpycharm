import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireUser, authErrorResponse } from "@/lib/auth";
import { recordAudit, clientIp } from "@/lib/audit";
import {
  generateTotpSecret,
  buildOtpauthUri,
  generateBackupCodes,
  hashBackupCode,
} from "@/lib/totp";
import { encryptPrivateKey } from "@/lib/crypto";

export const dynamic = "force-dynamic";

/**
 * POST /api/2fa/setup — start 2FA enrollment for the current user.
 *
 * Generates a new TOTP secret (encrypted at rest with the master key), stores
 * 10 one-time backup codes (scrypt-hashed), and returns the plaintext secret
 * + otpauth URI + plaintext backup codes ONCE. The `enabled` flag stays false
 * until the user proves they can produce a valid code via /api/2fa/verify.
 *
 * Privileged roles (OWNER, SECURITY_ADMIN, BRANCH_ADMIN) have `enforced=true`
 * set on the row — the system can later refuse sensitive actions for them
 * without 2FA. Regular users are not forced.
 */
export async function POST(req: Request) {
  try {
    const me = await requireUser();

    const secret = generateTotpSecret();
    const enc = encryptPrivateKey(secret);

    const backupCodes = generateBackupCodes(10);
    const backupHashes = backupCodes.map((c) => hashBackupCode(c));

    const enforced =
      me.role === "OWNER" ||
      me.role === "SECURITY_ADMIN" ||
      me.role === "BRANCH_ADMIN";

    await db.twoFactor.upsert({
      where: { userId: me.id },
      create: {
        userId: me.id,
        encryptedSecret: enc.ciphertext,
        secretIv: enc.iv,
        backupCodesHash: JSON.stringify(backupHashes),
        enabled: false,
        enforced,
      },
      update: {
        encryptedSecret: enc.ciphertext,
        secretIv: enc.iv,
        backupCodesHash: JSON.stringify(backupHashes),
        enabled: false,
        enforced,
        enrolledAt: null,
      },
    });

    await recordAudit({
      action: "2FA_ENROLL",
      actor: me.username,
      actorId: me.id,
      status: "SUCCESS",
      details: { enforced },
      ipAddress: clientIp(req),
    });

    return NextResponse.json({
      ok: true,
      secret,
      otpauthUri: buildOtpauthUri(secret, me.username),
      backupCodes,
    });
  } catch (err) {
    const r = authErrorResponse(err);
    return r ?? NextResponse.json({ ok: false, error: "Failed to start 2FA enrollment" }, { status: 500 });
  }
}
