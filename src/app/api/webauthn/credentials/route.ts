import { NextResponse } from "next/server";
import { requireUser, authErrorResponse } from "@/lib/auth";
import {
  getUserCredentials,
  revokeCredential,
  revokeAllCredentials,
} from "@/lib/webauthn";
import { recordAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

/**
 * GET /api/webauthn/credentials
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

/**
 * DELETE /api/webauthn/credentials
 *
 * Revoke a specific WebAuthn credential or all credentials.
 *
 * Body:
 *   - credentialId?: string - Specific credential to revoke
 *   - revokeAll?: boolean - Revoke all credentials
 */
export async function DELETE(req: Request) {
  try {
    const session = await requireUser();
    const body = await req.json();
    const { credentialId, revokeAll } = body as {
      credentialId?: string;
      revokeAll?: boolean;
    };

    if (revokeAll) {
      const count = await revokeAllCredentials(session.id);

      await recordAudit({
        action: "WEBAUTHN_CREDENTIAL_REVOKE_ALL",
        actor: session.username,
        actorId: session.id,
        status: "SUCCESS",
        details: { revokedCount: count },
        ipAddress: req.headers.get("x-forwarded-for") || undefined,
      });

      return NextResponse.json({ ok: true, revokedCount: count });
    }

    if (!credentialId) {
      return NextResponse.json(
        { ok: false, error: "credentialId or revokeAll is required" },
        { status: 400 }
      );
    }

    const revoked = await revokeCredential(credentialId, session.id);

    if (!revoked) {
      return NextResponse.json(
        { ok: false, error: "Credential not found" },
        { status: 404 }
      );
    }

    await recordAudit({
      action: "WEBAUTHN_CREDENTIAL_REVOKE",
      actor: session.username,
      actorId: session.id,
      status: "SUCCESS",
      details: { credentialId },
      ipAddress: req.headers.get("x-forwarded-for") || undefined,
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    const r = authErrorResponse(err);
    return r ?? NextResponse.json({ ok: false, error: "Failed to revoke credential" }, { status: 500 });
  }
}
