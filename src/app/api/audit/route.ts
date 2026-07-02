import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/** GET /api/audit — paginated audit log with optional action filter. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const action = url.searchParams.get("action");
  const status = url.searchParams.get("status");
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "100", 10), 500);

  const where: Record<string, unknown> = {};
  if (action) where.action = action;
  if (status) where.status = status;

  const logs = await db.auditLog.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: limit,
    include: {
      branch: { select: { id: true, code: true, name: true } },
      document: { select: { id: true, name: true } },
    },
  });

  // Aggregate counts by action for the filter chips.
  const actionCounts = await db.auditLog.groupBy({
    by: ["action"],
    _count: true,
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
}
