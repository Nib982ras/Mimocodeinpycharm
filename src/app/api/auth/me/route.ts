import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

/** GET /api/auth/me — return the current session user (or null). */
export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ ok: true, user: null });
  }
  return NextResponse.json({
    ok: true,
    user: {
      id: session.id,
      username: session.username,
      displayName: session.displayName,
      role: session.role,
      status: session.status,
      branchId: session.branchId,
      branch: session.branch,
      twoFactorEnabled: session.twoFactorEnabled,
      twoFactorEnforced: session.twoFactorEnforced,
    },
  });
}
