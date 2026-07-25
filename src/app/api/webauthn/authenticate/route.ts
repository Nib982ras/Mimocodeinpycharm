import { NextResponse } from "next/server";
import { startAuthentication, completeAuthentication } from "@/lib/webauthn";
import {
  createSessionToken,
  getSystemState,
  authErrorResponse,
} from "@/lib/auth";
import { db } from "@/lib/db";
import { cookies } from "next/headers";
import { recordAudit } from "@/lib/audit";
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

/** Session cookie name */
const SESSION_COOKIE = "secure-exchange-session";

/**
 * POST /api/webauthn/authenticate
 *
 * Start WebAuthn authentication process.
 * Returns authentication options for the browser.
 */
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const { username } = body as { username?: string };

    const options = await startAuthentication(username);

    return NextResponse.json({ ok: true, options });
  } catch (err) {
    console.error("WebAuthn auth start error:", err);
    return NextResponse.json({ ok: false, error: "Failed to start authentication" }, { status: 500 });
  }
}

/**
 * PUT /api/webauthn/authenticate
 *
 * Complete WebAuthn authentication process.
 * Verifies the authenticator response and creates a session.
 *
 * Security controls (matching password login):
 *   - Rate limiting (IP + credential ID)
 *   - System state checks (active + lockdown)
 *   - Session fingerprint binding
 *   - Concurrent session enforcement
 */
export async function PUT(req: Request) {
  const ip = getClientIp(req);

  try {
    const body = await req.json();

    const { options, response } = body as {
      options: any;
      response: any;
    };

    if (!options || !response) {
      return NextResponse.json(
        { ok: false, error: "Missing options or response" },
        { status: 400 }
      );
    }

    // Rate limit by IP and credential ID
    const credentialId = response?.id || "unknown";
    const rateLimitKey = `${ip}:webauthn:${credentialId}`;
    const rateLimit = await checkLoginRateLimit(ip, rateLimitKey);

    if (!rateLimit.allowed) {
      await recordAudit({
        action: "LOGIN_FAILED",
        actor: "unknown",
        status: "FAILURE",
        details: { reason: "RATE_LIMITED", method: "WEBAUTHN" },
        ipAddress: ip,
      });

      return NextResponse.json(
        { ok: false, error: "Too many authentication attempts. Please try again later." },
        {
          status: 429,
          headers: rateLimit.retryAfter
            ? { "Retry-After": String(rateLimit.retryAfter) }
            : {},
        }
      );
    }

    const result = await completeAuthentication(options, response);

    if (!result.verified || !result.userId) {
      // Record failure for rate limiting
      await recordLoginFailure(ip, rateLimitKey);

      await recordAudit({
        action: "LOGIN_FAILED",
        actor: "unknown",
        status: "FAILURE",
        details: { event: "WEBAUTHN_FAILED", reason: "Verification failed" },
        ipAddress: ip,
      });

      return NextResponse.json(
        { ok: false, error: "Authentication failed" },
        { status: 401 }
      );
    }

    // Get the user
    const user = await db.user.findUnique({
      where: { id: result.userId },
      include: {
        branch: { select: { id: true, code: true, name: true, type: true } },
        twoFactor: { select: { enabled: true, enforced: true } },
      },
    });

    if (!user || user.status !== "ACTIVE") {
      await recordAudit({
        action: "LOGIN_FAILED",
        actor: user?.username || "unknown",
        actorId: user?.id,
        status: "FAILURE",
        details: { reason: user ? user.status : "NOT_FOUND", method: "WEBAUTHN" },
        ipAddress: ip,
      });

      return NextResponse.json(
        { ok: false, error: "Account not found or inactive" },
        { status: 401 }
      );
    }

    // System-wide guards (matching password login)
    const state = await getSystemState();
    if (user.role !== "OWNER") {
      if (!state.active) {
        await recordAudit({
          action: "LOGIN_FAILED",
          actor: user.username,
          actorId: user.id,
          status: "FAILURE",
          details: { reason: "SYSTEM_DEACTIVATED", method: "WEBAUTHN" },
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
          details: { reason: "SYSTEM_LOCKDOWN", method: "WEBAUTHN" },
          ipAddress: ip,
        });
        return NextResponse.json(
          { ok: false, error: "System in lockdown" },
          { status: 403 }
        );
      }
    }

    // Create session fingerprint for binding
    const fingerprint = createSessionFingerprint(req);

    // Create session token with fingerprint
    const { token, jti } = createSessionToken({
      uid: user.id,
      username: user.username,
      role: user.role,
      branchId: user.branchId,
      branchCode: user.branch?.code || null,
      fingerprint,
    });

    // Create session record
    await db.session.create({
      data: {
        userId: user.id,
        tokenJti: jti,
        ipAddress: ip || "unknown",
        userAgent: req.headers.get("user-agent") || "unknown",
        fingerprint,
      },
    });

    // Enforce concurrent session limits
    await checkConcurrentSessions(user.id);

    // Reset rate limit on successful auth
    await resetLoginRateLimit(ip, rateLimitKey);

    // Set session cookie
    const cookieStore = await cookies();
    cookieStore.set(SESSION_COOKIE, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 24 * 60 * 60, // 24 hours
    });

    await recordAudit({
      action: "LOGIN",
      actor: user.username,
      actorId: user.id,
      branchId: user.branchId || undefined,
      status: "SUCCESS",
      details: {
        method: "webauthn",
        credentialId: result.credentialId,
      },
      ipAddress: ip,
    });

    return NextResponse.json({
      ok: true,
      user: {
        id: user.id,
        username: user.username,
        displayName: user.displayName,
        role: user.role,
        branch: user.branch,
        twoFactorEnabled: user.twoFactor?.enabled || false,
        twoFactorEnforced: user.twoFactor?.enforced || false,
      },
    });
  } catch (err) {
    console.error("WebAuthn auth complete error:", err);
    return NextResponse.json({ ok: false, error: "Authentication failed" }, { status: 500 });
  }
}
