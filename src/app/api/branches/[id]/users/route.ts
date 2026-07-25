import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireUser, authErrorResponse } from "@/lib/auth";

/** GET /api/branches/[id]/users — list active users in a branch (for DM targeting). */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const viewer = await requireUser();
    const { id: branchId } = await params;

    if (!branchId) {
      return NextResponse.json({ error: "branchId required" }, { status: 400 });
    }

    const users = await db.user.findMany({
      where: { branchId, status: "ACTIVE" },
      select: { id: true, username: true, displayName: true, role: true },
      orderBy: { displayName: "asc" },
    });

    // Exclude the viewer from the list
    const filtered = users.filter((u) => u.id !== viewer.id);

    return NextResponse.json({ users: filtered });
  } catch (err: unknown) {
    const r = authErrorResponse(err);
    if (r) return r;
    console.error("GET /api/branches/[id]/users:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
