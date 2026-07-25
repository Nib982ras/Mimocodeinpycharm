import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireSecurityAdmin, authErrorResponse, hashPassword } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

/**
 * POST /api/users/[id]/password — reset a user's password (SECURITY_ADMIN+).
 *
 * Password policy:
 *   - Minimum 12 characters
 *   - At least one uppercase letter
 *   - At least one lowercase letter
 *   - At least one digit
 *   - At least one special character (!@#$%^&*)
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const admin = await requireSecurityAdmin();
    const { id } = await params;
    const body = await req.json().catch(() => ({}));
    const { password } = body as { password?: string };

    if (!password) {
      return NextResponse.json(
        { ok: false, error: "Password is required" },
        { status: 400 }
      );
    }

    // Enforce password policy
    const errors: string[] = [];
    if (password.length < 12) errors.push("at least 12 characters");
    if (!/[A-Z]/.test(password)) errors.push("at least one uppercase letter");
    if (!/[a-z]/.test(password)) errors.push("at least one lowercase letter");
    if (!/[0-9]/.test(password)) errors.push("at least one digit");
    if (!/[!@#$%^&*]/.test(password)) errors.push("at least one special character (!@#$%^&*)");

    if (errors.length > 0) {
      return NextResponse.json(
        { ok: false, error: `Password must contain ${errors.join(", ")}` },
        { status: 400 }
      );
    }

    const user = await db.user.findUnique({ where: { id } });
    if (!user) {
      return NextResponse.json({ ok: false, error: "User not found" }, { status: 404 });
    }

    // Only OWNER can reset another OWNER's password
    if (user.role === "OWNER" && admin.role !== "OWNER") {
      return NextResponse.json(
        { ok: false, error: "Only the Owner can reset the Owner's password" },
        { status: 403 }
      );
    }

    // SECURITY_ADMIN cannot reset password of equal or higher privilege
    if (admin.role === "SECURITY_ADMIN" && user.role === "SECURITY_ADMIN") {
      return NextResponse.json(
        { ok: false, error: "Cannot reset password of another Security Admin" },
        { status: 403 }
      );
    }

    await db.user.update({
      where: { id },
      data: { passwordHash: hashPassword(password) },
    });

    // Revoke all active sessions for the target user so they must re-login
    await db.session.updateMany({
      where: { userId: id, revoked: false },
      data: { revoked: true, revokedAt: new Date() },
    });

    await recordAudit({
      action: "PASSWORD_RESET",
      actor: admin.username,
      actorId: admin.id,
      status: "SUCCESS",
      details: { target: user.username },
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    const r = authErrorResponse(err);
    return r ?? NextResponse.json({ ok: false, error: "Failed to reset password" }, { status: 500 });
  }
}
