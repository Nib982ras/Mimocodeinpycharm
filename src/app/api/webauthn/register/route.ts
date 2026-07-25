import { NextResponse } from "next/server";
import { requireUser, authErrorResponse } from "@/lib/auth";
import {
  startRegistration,
  completeRegistration,
  getUserCredentials,
} from "@/lib/webauthn";
import { recordAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

/**
 * POST /api/webauthn/register
 *
 * Start WebAuthn registration process.
 * Returns registration options for the browser.
 */
export async function POST(req: Request) {
  try {
    const session = await requireUser();
    const body = await req.json().catch(() => ({}));
    const { deviceName } = body as { deviceName?: string };

    // Check if user already has credentials
    const existingCredentials = await getUserCredentials(session.id);

    const options = await startRegistration(
      session.id,
      session.username,
      session.displayName
    );

    await recordAudit({
      action: "WEBAUTHN_REGISTER_START",
      actor: session.username,
      actorId: session.id,
      status: "SUCCESS",
      details: {
        existingCredentials: existingCredentials.length,
        deviceName,
      },
      ipAddress: req.headers.get("x-forwarded-for") || undefined,
    });

    return NextResponse.json({
      ok: true,
      options,
      existingCredentials: existingCredentials.length,
    });
  } catch (err) {
    const r = authErrorResponse(err);
    return r ?? NextResponse.json({ ok: false, error: "Failed to start registration" }, { status: 500 });
  }
}

/**
 * PUT /api/webauthn/register
 *
 * Complete WebAuthn registration process.
 * Verifies the authenticator response and stores the credential.
 */
export async function PUT(req: Request) {
  try {
    const session = await requireUser();
    const body = await req.json();

    const { options, response, deviceName } = body as {
      options: any;
      response: any;
      deviceName?: string;
    };

    if (!options || !response) {
      return NextResponse.json(
        { ok: false, error: "Missing options or response" },
        { status: 400 }
      );
    }

    const result = await completeRegistration(
      session.id,
      options,
      response,
      deviceName
    );

    if (!result.success) {
      await recordAudit({
        action: "WEBAUTHN_REGISTER_FAIL",
        actor: session.username,
        actorId: session.id,
        status: "FAILURE",
        details: { reason: "Verification failed" },
        ipAddress: req.headers.get("x-forwarded-for") || undefined,
      });

      return NextResponse.json(
        { ok: false, error: "Registration failed" },
        { status: 400 }
      );
    }

    await recordAudit({
      action: "WEBAUTHN_REGISTER_COMPLETE",
      actor: session.username,
      actorId: session.id,
      status: "SUCCESS",
      details: { credentialId: result.credentialId, deviceName },
      ipAddress: req.headers.get("x-forwarded-for") || undefined,
    });

    return NextResponse.json({
      ok: true,
      credentialId: result.credentialId,
    });
  } catch (err) {
    const r = authErrorResponse(err);
    return r ?? NextResponse.json({ ok: false, error: "Failed to complete registration" }, { status: 500 });
  }
}

/**
 * GET /api/webauthn/register
 *
 * List all WebAuthn credentials for the current user.
 */
export async function GET() {
  try {
    const session = await requireUser();
    const credentials = await getUserCredentials(session.id);

    return NextResponse.json({ ok: true, credentials });
  } catch (err) {
    const r = authErrorResponse(err);
    return r ?? NextResponse.json({ ok: false, error: "Failed to list credentials" }, { status: 500 });
  }
}
