import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAdmin, authErrorResponse } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

/** DELETE /api/users/[id] — delete a user (admin only). */
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const admin = await requireAdmin();
    const { id } = await params;

    if (id === admin.id) {
      return NextResponse.json(
        { ok: false, error: "You cannot delete your own account" },
        { status: 400 }
      );
    }

    const user = await db.user.findUnique({ where: { id } });
    if (!user) {
      return NextResponse.json({ ok: false, error: "User not found" }, { status: 404 });
    }

    await db.user.delete({ where: { id } });

    await recordAudit({
      action: "SYSTEM",
      actor: admin.username,
      status: "SUCCESS",
      details: { event: "USER_DELETE", deletedUser: user.username, deletedRole: user.role },
      ipAddress: req.headers.get("x-forwarded-for") || undefined,
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    const r = authErrorResponse(err);
    return r ?? NextResponse.json({ ok: false, error: "Failed to delete user" }, { status: 500 });
  }
}
