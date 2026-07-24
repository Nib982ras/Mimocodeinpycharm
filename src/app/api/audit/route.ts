import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireUser, authErrorResponse, ROLE_RANK } from "@/lib/auth";

export const dynamic = "force-dynamic";

/** GET /api/audit — paginated audit log.
 *  SECURITY_ADMIN+ sees all events; other roles see only their own branch's events.
 */
export async function GET(req: Request) {
  try {
    const session = await requireUser();
    const url = new URL(req.url);
    const action = url.searchParams.get("action");
    const status = url.searchParams.get("status");
    const limit = Math.min(parseInt(url.searchParams.get("limit") || "100", 10), 500);

    const isAdmin = ROLE_RANK[session.role] >= ROLE_RANK.SECURITY_ADMIN;
    const where: Record<string, unknown> = {};
    if (action) where.action = action;
    if (status) where.status = status;
    if (!isAdmin) {
      // Regular users only see audit events tied to their branch.
      where.branchId = session.branchId;
    }

    const logs = await db.auditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: limit,
      include: {
        branch: { select: { id: true, code: true, name: true } },
        document: { select: { id: true, name: true } },
      },
    });

    const actionCounts = await db.auditLog.groupBy({
      by: ["action"],
      _count: true,
      where: !isAdmin ? { branchId: session.branchId } : undefined,
    });

    return NextResponse.json({
      ok: true,
      counts: Object.fromEntries(actionCounts.map((a) => [a.action, a._count])),
      logs: logs.map((l) => ({
        id: l.id,
        action: l.action,
        actor: l.actor,
        status: l.status,
        details: l.details,
        ipAddress: l.ipAddress,
        branch: l.branch,
        document: l.document,
        createdAt: l.createdAt.toISOString(),
      })),
    });
  } catch (err) {
    const r = authErrorResponse(err);
    return r ?? NextResponse.json({ ok: false, error: "Failed to load audit log" }, { status: 500 });
  }
}
