import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  verifyPassword,
  createSessionToken,
  setSessionCookie,
  getSystemState,
  authErrorResponse,
} from "@/lib/auth";
import { recordAudit, clientIp } from "@/lib/audit";
import { verifyTotp, verifyBackupCode } from "@/lib/totp";
import { decryptPrivateKey } from "@/lib/crypto";

export const dynamic = "force-dynamic";

/**
 * POST /api/auth/login — two-step authentication with optional 2FA.
 *
 * Step 1: client submits `{ username, password }`.
 *   - If credentials are valid AND the user has no enabled 2FA → session set,
 *     returns `{ ok: true, user }`.
 *   - If credentials are valid AND the user has 2FA enabled → returns
 *     `{ ok: false, requiresTwoFactor: true }` WITHOUT setting a cookie. The
 *     frontend prompts for a 6-digit code or backup code and resubmits the
 *     full triple `{ username, password, totpCode? | backupCode? }`.
 *
 * Step 2: the same endpoint verifies the 2FA factor, then sets the session.
 *
 * Security properties:
 *  - Constant-time password verification (always runs scrypt even when the
 *    user doesn't exist) to prevent user enumeration.
 *  - 2FA failures are audited with status=FAILURE but the user is not told
 *    which factor was wrong (only "Invalid 2FA code").
 *  - System deactivation / lockdown block all non-OWNER logins.
 *  - Suspended/revoked accounts cannot log in (403 with the status name).
 */
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const { username, password, totpCode, backupCode } = body as {
      username?: string;
      password?: string;
      totpCode?: string;
      backupCode?: string;
    };

    if (!username || !password) {
      return NextResponse.json(
        { ok: false, error: "Username and password are required" },
        { status: 400 }
      );
    }

    const uname = username.toLowerCase();
    const ip = clientIp(req);
    const ua = req.headers.get("user-agent") || undefined;

    const user = await db.user.findUnique({
      where: { username: uname },
      include: {
        branch: { select: { id: true, code: true, name: true, type: true } },
        twoFactor: true,
      },
    });

    // Always run scrypt to avoid timing-based user enumeration.
    const passwordOk = user
      ? verifyPassword(password, user.passwordHash)
      : verifyPassword(password, "00:00");

    if (!user || !passwordOk) {
      await recordAudit({
        action: "LOGIN_FAILED",
        actor: uname,
        status: "FAILURE",
        details: { reason: "BAD_CREDENTIALS" },
        ipAddress: ip,
      });
      return NextResponse.json(
        { ok: false, error: "Invalid username or password" },
        { status: 401 }
      );
    }

    // Account status check (only on valid credentials — otherwise we'd leak
    // status info to an attacker who doesn't know the password).
    if (user.status !== "ACTIVE") {
      await recordAudit({
        action: "LOGIN_FAILED",
        actor: user.username,
        actorId: user.id,
        status: "FAILURE",
        details: { reason: user.status },
        ipAddress: ip,
      });
      return NextResponse.json(
        { ok: false, error: `Account is ${user.status}` },
        { status: 403 }
      );
    }

    // System-wide guards. The owner always bypasses deactivation/lockdown so
    // they can recover a frozen system.
    const state = await getSystemState();
    if (user.role !== "OWNER") {
      if (!state.active) {
        await recordAudit({
          action: "LOGIN_FAILED",
          actor: user.username,
          actorId: user.id,
          status: "FAILURE",
          details: { reason: "SYSTEM_DEACTIVATED" },
          ipAddress: ip,
        });
        return NextResponse.json(
          { ok: false, error: "System deactivated" },
          { status: 403 }
        );
      }
      if (state.lockdown) {
        await recordAudit({
          action: "LOGIN_FAILED",
          actor: user.username,
          actorId: user.id,
          status: "FAILURE",
          details: { reason: "SYSTEM_LOCKDOWN", lockdownReason: state.lockdownReason ?? null },
          ipAddress: ip,
        });
        return NextResponse.json(
          { ok: false, error: "System in lockdown" },
          { status: 403 }
        );
      }
    }

    // 2FA enforcement.
    const tf = user.twoFactor;
    if (tf && tf.enabled) {
      const hasFactor = totpCode || backupCode;
      if (!hasFactor) {
        // Don't set cookie yet — client must collect a 2FA factor and re-submit.
        return NextResponse.json({ ok: false, requiresTwoFactor: true });
      }

      let factorOk = false;
      let usedBackupIndex = -1;

      if (totpCode) {
        try {
          const secret = decryptPrivateKey(tf.encryptedSecret, tf.secretIv);
          factorOk = verifyTotp(secret, totpCode);
        } catch {
          factorOk = false;
        }
      } else if (backupCode) {
        let hashes: string[] = [];
        try {
          hashes = JSON.parse(tf.backupCodesHash || "[]") as string[];
        } catch {
          hashes = [];
        }
        for (let i = 0; i < hashes.length; i++) {
          if (verifyBackupCode(backupCode, hashes[i])) {
            factorOk = true;
            usedBackupIndex = i;
            break;
          }
        }
      }

      if (!factorOk) {
        await recordAudit({
          action: "2FA_FAIL",
          actor: user.username,
          actorId: user.id,
          status: "FAILURE",
          details: { factor: totpCode ? "TOTP" : "BACKUP_CODE" },
          ipAddress: ip,
        });
        return NextResponse.json(
          { ok: false, error: "Invalid 2FA code" },
          { status: 401 }
        );
      }

      // Backup codes are single-use — burn the consumed hash.
      if (usedBackupIndex >= 0) {
        let hashes: string[] = [];
        try {
          hashes = JSON.parse(tf.backupCodesHash || "[]") as string[];
        } catch {
          hashes = [];
        }
        hashes.splice(usedBackupIndex, 1);
        await db.twoFactor.update({
          where: { userId: user.id },
          data: { backupCodesHash: JSON.stringify(hashes) },
        });
      }

      await recordAudit({
        action: "2FA_VERIFY",
        actor: user.username,
        actorId: user.id,
        status: "SUCCESS",
        details: { factor: totpCode ? "TOTP" : "BACKUP_CODE" },
        ipAddress: ip,
      });
    }

    // Issue the session.
    const { token, jti } = createSessionToken({
      uid: user.id,
      username: user.username,
      role: user.role,
      branchId: user.branchId,
      branchCode: user.branch?.code ?? null,
    });

    await db.session.create({
      data: {
        userId: user.id,
        tokenJti: jti,
        ipAddress: ip ?? null,
        userAgent: ua ?? null,
      },
    });

    await setSessionCookie(token);

    await recordAudit({
      action: "LOGIN",
      actor: user.username,
      actorId: user.id,
      branchId: user.branchId ?? undefined,
      status: "SUCCESS",
      details: { role: user.role, jti },
      ipAddress: ip,
    });

    return NextResponse.json({
      ok: true,
      user: {
        id: user.id,
        username: user.username,
        displayName: user.displayName,
        role: user.role,
        branchId: user.branchId,
        branch: user.branch,
        twoFactorEnabled: tf?.enabled ?? false,
        twoFactorEnforced: tf?.enforced ?? false,
      },
    });
  } catch (err) {
    const r = authErrorResponse(err);
    return r ?? NextResponse.json({ ok: false, error: "Login failed" }, { status: 500 });
  }
}
