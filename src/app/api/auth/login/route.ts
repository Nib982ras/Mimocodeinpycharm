import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  verifyPassword,
  createSessionToken,
  setSessionCookie,
  getSystemState,
  authErrorResponse,
} from "@/lib/auth";
import { recordAudit } from "@/lib/audit";
import { verifyTotp, verifyBackupCode } from "@/lib/totp";
import { decryptPrivateKey } from "@/lib/crypto";
import {
  checkLoginRateLimit,
  recordLoginFailure,
  resetLoginRateLimit,
  getClientIp,
} from "@/lib/rate-limit";
import {
  createSessionFingerprint,
  checkConcurrentSessions,
} from "@/lib/session-security";

export const dynamic = "force-dynamic";

/**
 * POST /api/auth/login — two-step authentication with optional 2FA.
 *
 * Rate limited: 5 attempts per 15 minutes per IP AND per username.
 * Dual tracking prevents distributed brute force across multiple IPs.
 * Progressive lockout doubles block duration on repeated violations.
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

    const ip = getClientIp(req);
    const ua = req.headers.get("user-agent") || undefined;
    const uname = username.toLowerCase();

    // Dual rate limiting: check both IP and username
    const rateLimit = await checkLoginRateLimit(ip, uname);

    if (!rateLimit.allowed) {
      await recordAudit({
        action: "LOGIN_FAILED",
        actor: uname,
        status: "FAILURE",
        details: { reason: "RATE_LIMITED", blockedBy: rateLimit.blockedBy },
        ipAddress: ip,
      });
      return NextResponse.json(
        { ok: false, error: "Too many login attempts. Please try again later." },
        {
          status: 429,
          headers: rateLimit.retryAfter
            ? { "Retry-After": String(rateLimit.retryAfter) }
            : {},
        }
      );
    }

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
      // Record failure for both IP and username
      await recordLoginFailure(ip, uname);

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

    // Account status check
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

    // System-wide guards
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

    // 2FA enforcement
    const tf = user.twoFactor;
    if (tf && tf.enabled) {
      const hasFactor = totpCode || backupCode;
      if (!hasFactor) {
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
        await recordLoginFailure(ip, uname);

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

      // Burn used backup code
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

    // Success — reset rate limits for this IP and username
    await resetLoginRateLimit(ip, uname);

    // Enforce maximum concurrent sessions
    await checkConcurrentSessions(user.id);

    // Create session with fingerprint
    const fingerprint = createSessionFingerprint(req);
    const { token, jti } = createSessionToken({
      uid: user.id,
      username: user.username,
      role: user.role,
      branchId: user.branchId,
      branchCode: user.branch?.code ?? null,
      fingerprint,
    });

    await db.session.create({
      data: {
        userId: user.id,
        tokenJti: jti,
        ipAddress: ip ?? null,
        userAgent: ua ?? null,
        fingerprint,
      },
    });

    await setSessionCookie(token);

    await recordAudit({
      action: "LOGIN",
      actor: user.username,
      actorId: user.id,
      branchId: user.branchId ?? undefined,
      status: "SUCCESS",
      details: { role: user.role, jti, fingerprint: fingerprint.substring(0, 8) + "..." },
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
