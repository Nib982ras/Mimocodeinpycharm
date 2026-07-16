import { NextResponse } from "next/server";
import { clearSessionCookie, getSession } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

/** POST /api/auth/logout — clear the session cookie. */
export async function POST() {
  const session = await getSession();
  if (session) {
    await recordAudit({
      action: "SYSTEM",
      actor: session.username,
      branchId: session.branchId ?? undefined,
      status: "SUCCESS",
      details: { event: "LOGOUT" },
    });
  }
  await clearSessionCookie();
  return NextResponse.json({ ok: true });
}
