import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireSecurityAdmin, authErrorResponse, hashPassword } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

/** POST /api/users/[id]/password — reset a user's password (SECURITY_ADMIN+). */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const admin = await requireSecurityAdmin();
    const { id } = await params;
    const body = await req.json().catch(() => ({}));
    const { password } = body as { password?: string };

    if (!password || password.length < 4) {
      return NextResponse.json(
        { ok: false, error: "Password must be at least 4 characters" },
        { status: 400 }
      );
    }

    const user = await db.user.findUnique({ where: { id } });
    if (!user) {
      return NextResponse.json({ ok: false, error: "User not found" }, { status: 404 });
    }

    await db.user.update({
      where: { id },
      data: { passwordHash: hashPassword(password) },
    });

    await recordAudit({
      action: "SYSTEM",
      actor: admin.username,
      status: "SUCCESS",
      details: { event: "PASSWORD_RESET", target: user.username },
      ipAddress: req.headers.get("x-forwarded-for") || undefined,
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    const r = authErrorResponse(err);
    return r ?? NextResponse.json({ ok: false, error: "Failed to reset password" }, { status: 500 });
  }
}
