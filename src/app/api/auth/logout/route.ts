import { NextResponse } from "next/server";
import { clearSessionCookie, getSession, verifySessionToken, SESSION_COOKIE } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";
import { cookies } from "next/headers";

export const dynamic = "force-dynamic";

/**
 * POST /api/auth/logout — revoke the current session and clear the cookie.
 *
 * This endpoint:
 *   1. Extracts the JTI from the current session token
 *   2. Marks the session as revoked in the database
 *   3. Clears the session cookie
 *
 * This ensures a stolen cookie cannot be used after logout.
 */
export async function POST() {
  try {
    const store = await cookies();
    const token = store.get(SESSION_COOKIE)?.value;

    if (token) {
      // Extract the JTI from the token to revoke it
      const payload = verifySessionToken(token);
      if (payload) {
        // Revoke the session in the database
        const { db } = await import("@/lib/db");
        await db.session.updateMany({
          where: { tokenJti: payload.jti, revoked: false },
          data: { revoked: true, revokedAt: new Date() },
        });
      }

      // Audit the logout
      const session = await getSession();
      if (session) {
        await recordAudit({
          action: "LOGOUT",
          actor: session.username,
          actorId: session.id,
          branchId: session.branchId ?? undefined,
          status: "SUCCESS",
          details: { event: "LOGOUT" },
        });
      }
    }
  } catch {
    // Best effort — still clear the cookie even if DB operations fail
  }

  await clearSessionCookie();
  return NextResponse.json({ ok: true });
}
