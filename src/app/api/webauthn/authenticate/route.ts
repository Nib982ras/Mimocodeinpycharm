import { NextResponse } from "next/server";
import { startAuthentication, completeAuthentication } from "@/lib/webauthn";
import { createSessionToken } from "@/lib/auth";
import { db } from "@/lib/db";
import { cookies } from "next/headers";
import { recordAudit } from "@/lib/audit";

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
 */
export async function PUT(req: Request) {
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

    const result = await completeAuthentication(options, response);

    if (!result.verified || !result.userId) {
      await recordAudit({
        action: "LOGIN_FAILED",
        actor: "unknown",
        status: "FAILURE",
        details: { event: "WEBAUTHN_FAILED", reason: "Verification failed" },
        ipAddress: req.headers.get("x-forwarded-for") || undefined,
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
      return NextResponse.json(
        { ok: false, error: "Account not found or inactive" },
        { status: 401 }
      );
    }

    // Create session token
    const { token, jti } = createSessionToken({
      uid: user.id,
      username: user.username,
      role: user.role,
      branchId: user.branchId,
      branchCode: user.branch?.code || null,
    });

    // Create session record
    await db.session.create({
      data: {
        userId: user.id,
        tokenJti: jti,
        ipAddress: req.headers.get("x-forwarded-for") || "unknown",
        userAgent: req.headers.get("user-agent") || "unknown",
      },
    });

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
      ipAddress: req.headers.get("x-forwarded-for") || undefined,
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
