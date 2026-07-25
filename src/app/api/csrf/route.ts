import { NextResponse } from "next/server";
import { setCsrfToken } from "@/lib/csrf";

export const dynamic = "force-dynamic";

/**
 * GET /api/csrf — Generate and return a CSRF token.
 *
 * The token is also set as a cookie (readable by JavaScript).
 * The client should include this token in the X-CSRF-Token header
 * for all state-changing requests (POST, PUT, DELETE).
 */
export async function GET() {
  const token = await setCsrfToken();
  return NextResponse.json({ ok: true, token });
}
