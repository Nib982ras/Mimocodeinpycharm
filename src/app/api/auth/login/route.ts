import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { verifyPassword, createSessionToken, setSessionCookie } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

/** POST /api/auth/login — authenticate with username + password, set session cookie. */
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const { username, password } = body as { username?: string; password?: string };

  if (!username || !password) {
    return NextResponse.json(
      { ok: false, error: "Username and password are required" },
      { status: 400 }
    );
  }

  const user = await db.user.findUnique({
    where: { username: username.toLowerCase() },
    include: { branch: { select: { id: true, code: true, name: true, type: true } } },
  });

  // Always run a verify to avoid timing-based user enumeration.
  const valid = user ? verifyPassword(password, user.passwordHash) : verifyPassword(password, "00:00");
  if (!user || !valid) {
    await recordAudit({
      action: "SYSTEM",
      actor: username.toLowerCase(),
      status: "FAILURE",
      details: { event: "LOGIN_FAILED" },
      ipAddress: req.headers.get("x-forwarded-for") || undefined,
    });
    return NextResponse.json(
      { ok: false, error: "Invalid username or password" },
      { status: 401 }
    );
  }

  const token = createSessionToken({
    uid: user.id,
    username: user.username,
    role: user.role,
    branchId: user.branchId,
    branchCode: user.branch?.code ?? null,
  });
  await setSessionCookie(token);

  await recordAudit({
    action: "SYSTEM",
    actor: user.username,
    branchId: user.branchId ?? undefined,
    status: "SUCCESS",
    details: { event: "LOGIN_SUCCESS", role: user.role },
    ipAddress: req.headers.get("x-forwarded-for") || undefined,
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
    },
  });
}
