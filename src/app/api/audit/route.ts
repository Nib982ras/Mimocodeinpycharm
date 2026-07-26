import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireUser, authErrorResponse, ROLE_RANK } from "@/lib/auth";
import { parsePagination, buildIdCursorWhere, simplePaginatedResponse } from "@/lib/pagination";

export const dynamic = "force-dynamic";

/** GET /api/audit — paginated audit log.
 *  Query params: cursor, limit (default 50, max 200), action, status, startDate, endDate
 *  SECURITY_ADMIN+ sees all events; other roles see only their own branch's events.
 */
export async function GET(req: Request) {
  try {
    const session = await requireUser();
    const url = new URL(req.url);
    const action = url.searchParams.get("action");
    const status = url.searchParams.get("status");
    const startDate = url.searchParams.get("startDate");
    const endDate = url.searchParams.get("endDate");
    const pagination = parsePagination(url);

    const isAdmin = ROLE_RANK[session.role] >= ROLE_RANK.SECURITY_ADMIN;
    const where: Record<string, unknown> = {};
    if (action) where.action = action;
    if (status) where.status = status;
    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) (where.createdAt as Record<string, unknown>).gte = new Date(startDate);
      if (endDate) (where.createdAt as Record<string, unknown>).lte = new Date(endDate);
    }
    if (!isAdmin) {
      where.branchId = session.branchId;
    }

    const paginatedWhere = buildIdCursorWhere(where, pagination);

    const logs = await db.auditLog.findMany({
      where: paginatedWhere,
      orderBy: { createdAt: "desc" },
      take: pagination.limit + 1,
      include: {
        branch: { select: { id: true, code: true, name: true } },
        document: { select: { id: true, name: true } },
      },
    });

    const result = simplePaginatedResponse(logs, pagination, undefined, (l) => ({
      id: l.id,
      action: l.action,
      actor: l.actor,
      status: l.status,
      details: l.details,
      ipAddress: l.ipAddress,
      branch: l.branch,
      document: l.document,
      createdAt: l.createdAt.toISOString(),
    }));

    // Get action counts (not paginated — summary only)
    const actionCounts = await db.auditLog.groupBy({
      by: ["action"],
      _count: true,
      where: !isAdmin ? { branchId: session.branchId } : undefined,
    });

    return NextResponse.json({
      ok: true,
      counts: Object.fromEntries(actionCounts.map((a) => [a.action, a._count])),
      logs: result.data,
      pagination: result.pagination,
    });
  } catch (err) {
    const r = authErrorResponse(err);
    return r ?? NextResponse.json({ ok: false, error: "Failed to load audit log" }, { status: 500 });
  }
}
