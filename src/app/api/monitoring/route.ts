import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireSecurityAdmin, authErrorResponse } from "@/lib/auth";
import { getCounter, getGauge, getHistogramStats } from "@/lib/metrics";
import { getCacheStats } from "@/lib/cache";
import { isRedisAvailable } from "@/lib/redis";
import { getActiveSessionCount } from "@/lib/session-security";

export const dynamic = "force-dynamic";

/**
 * GET /api/monitoring — Real-time monitoring dashboard data.
 *
 * Requires SECURITY_ADMIN authentication.
 * Aggregates in-memory metrics + database stats for a comprehensive view.
 */
export async function GET() {
  try {
    await requireSecurityAdmin();

    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    const [
      // Entity counts
      userCount,
      activeUserCount,
      suspendedUserCount,
      branchCount,
      documentCount,
      keyCount,
      activeKeyCount,
      sessionCount,
      deviceCount,
      licenseCount,
      auditCount,

      // Time-series: documents per hour (last 24h)
      docsByHour,

      // Time-series: audit events per hour (last 24h)
      auditByHour,

      // Time-series: auth attempts per hour (last 24h)
      authByHour,

      // Documents by status
      docsByStatus,

      // Documents by branch (top 10)
      docsByBranch,

      // Audit events by action (top 10)
      auditByAction,

      // Auth attempts by method
      authByMethod,

      // Users by role
      usersByRole,

      // Keys by status
      keysByStatus,

      // Recent security events
      recentSecurityEvents,

      // Active sessions count
      activeSessions,

      // Redis status
      redisUp,
    ] = await Promise.all([
      // Entity counts
      db.user.count(),
      db.user.count({ where: { status: "ACTIVE" } }),
      db.user.count({ where: { status: "SUSPENDED" } }),
      db.branch.count(),
      db.document.count(),
      db.key.count(),
      db.key.count({ where: { status: "ACTIVE" } }),
      db.session.count({ where: { revoked: false } }),
      db.device.count(),
      db.license.count(),
      db.auditLog.count(),

      // Documents per hour (last 24h) — raw SQL for date truncation
      db.$queryRawUnsafe(`
        SELECT
          date_trunc('hour', "createdAt") AS hour,
          COUNT(*)::int AS count
        FROM "Document"
        WHERE "createdAt" >= $1
        GROUP BY date_trunc('hour', "createdAt")
        ORDER BY hour ASC
      `, oneDayAgo),

      // Audit events per hour (last 24h)
      db.$queryRawUnsafe(`
        SELECT
          date_trunc('hour', "createdAt") AS hour,
          COUNT(*)::int AS count
        FROM "AuditLog"
        WHERE "createdAt" >= $1
        GROUP BY date_trunc('hour', "createdAt")
        ORDER BY hour ASC
      `, oneDayAgo),

      // Auth attempts per hour (last 24h)
      db.$queryRawUnsafe(`
        SELECT
          date_trunc('hour', "createdAt") AS hour,
          action,
          status,
          COUNT(*)::int AS count
        FROM "AuditLog"
        WHERE "createdAt" >= $1
          AND action IN ('LOGIN', 'LOGIN_FAILED', '2FA_FAIL')
        GROUP BY date_trunc('hour', "createdAt"), action, status
        ORDER BY hour ASC
      `, oneDayAgo),

      // Documents by status
      db.document.groupBy({ by: ["status"], _count: true }),

      // Documents by branch (top 10 senders)
      db.$queryRawUnsafe(`
        SELECT b.code, b.name, COUNT(d.id)::int AS count
        FROM "Document" d
        JOIN "Branch" b ON b.id = d."senderBranchId"
        GROUP BY b.code, b.name
        ORDER BY count DESC
        LIMIT 10
      `),

      // Audit events by action (top 10)
      db.auditLog.groupBy({ by: ["action"], _count: true, orderBy: { _count: { action: "desc" } }, take: 10 }),

      // Auth attempts by method
      db.$queryRawUnsafe(`
        SELECT
          COALESCE(details->>'method', 'password') AS method,
          status,
          COUNT(*)::int AS count
        FROM "AuditLog"
        WHERE action IN ('LOGIN', 'LOGIN_FAILED')
          AND "createdAt" >= $1
        GROUP BY COALESCE(details->>'method', 'password'), status
      `, oneWeekAgo),

      // Users by role
      db.user.groupBy({ by: ["role"], _count: true }),

      // Keys by status
      db.key.groupBy({ by: ["status"], _count: true }),

      // Recent security events (last 24h)
      db.auditLog.findMany({
        where: {
          createdAt: { gte: oneDayAgo },
          action: { in: ["LOGIN_FAILED", "2FA_FAIL", "LOCKDOWN", "KEY_DESTROY", "USER_SUSPEND"] },
        },
        take: 20,
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          action: true,
          actor: true,
          status: true,
          ipAddress: true,
          createdAt: true,
          details: true,
        },
      }),

      // Active sessions
      db.session.count({ where: { revoked: false } }),

      // Redis
      isRedisAvailable(),
    ]);

    // Build hourly time series (fill gaps with 0)
    const docTimeSeries = fillHourlyGaps(docsByHour as any[], oneDayAgo, now);
    const auditTimeSeries = fillHourlyGaps(auditByHour as any[], oneDayAgo, now);

    // Build auth time series
    const authTimeSeries = buildAuthTimeSeries(authByHour as any[], oneDayAgo, now);

    // Cache stats
    const cacheStats = getCacheStats();

    // In-memory metrics
    const httpRequests = getCounter("http_requests_total");
    const httpErrors = getCounter("http_requests_total", { status: "500" }) +
                       getCounter("http_requests_total", { status: "400" }) +
                       getCounter("http_requests_total", { status: "401" }) +
                       getCounter("http_requests_total", { status: "403" });
    const dbQueryAvg = getHistogramStats("database_query_duration_seconds")?.avg ?? 0;
    const encryptOps = getCounter("encryption_operations_total");

    // Memory usage
    const mem = process.memoryUsage();

    return NextResponse.json({
      ok: true,
      timestamp: now.toISOString(),

      // Entity counts
      entities: {
        users: userCount,
        activeUsers: activeUserCount,
        suspendedUsers: suspendedUserCount,
        branches: branchCount,
        documents: documentCount,
        keys: keyCount,
        activeKeys: activeKeyCount,
        sessions: sessionCount,
        activeSessions,
        devices: deviceCount,
        licenses: licenseCount,
        auditEvents: auditCount,
      },

      // Time series
      timeSeries: {
        documentsPerHour: docTimeSeries,
        auditPerHour: auditTimeSeries,
        authAttempts: authTimeSeries,
      },

      // Breakdowns
      breakdowns: {
        documentsByStatus: (docsByStatus as any[]).map((r) => ({ status: r.status, count: r._count })),
        documentsByBranch: (docsByBranch as any[]).map((r) => ({ code: r.code, name: r.name, count: r.count })),
        auditByAction: (auditByAction as any[]).map((r) => ({ action: r.action, count: r._count })),
        authByMethod: (authByMethod as any[]).map((r) => ({ method: r.method, status: r.status, count: r.count })),
        usersByRole: (usersByRole as any[]).map((r) => ({ role: r.role, count: r._count })),
        keysByStatus: (keysByStatus as any[]).map((r) => ({ status: r.status, count: r._count })),
      },

      // Security events
      securityEvents: recentSecurityEvents.map((e) => ({
        id: e.id,
        action: e.action,
        actor: e.actor,
        status: e.status,
        ipAddress: e.ipAddress,
        createdAt: e.createdAt.toISOString(),
        details: e.details,
      })),

      // System health
      health: {
        uptime: process.uptime(),
        memoryMB: {
          rss: Math.round(mem.rss / 1024 / 1024),
          heapUsed: Math.round(mem.heapUsed / 1024 / 1024),
          heapTotal: Math.round(mem.heapTotal / 1024 / 1024),
        },
        redis: redisUp,
        dbQueryAvgMs: Math.round(dbQueryAvg * 1000),
        httpRequests,
        httpErrors,
        encryptOps,
        cache: cacheStats,
      },
    });
  } catch (err) {
    const r = authErrorResponse(err);
    return r ?? NextResponse.json({ ok: false, error: "Failed to load monitoring data" }, { status: 500 });
  }
}

// ---------- Helpers ----------

function fillHourlyGaps(
  rows: Array<{ hour: string | Date; count: number }>,
  from: Date,
  to: Date
): Array<{ hour: string; count: number }> {
  const map = new Map<string, number>();
  for (const r of rows) {
    const h = new Date(r.hour).toISOString().slice(0, 13);
    map.set(h, (map.get(h) || 0) + r.count);
  }

  const result: Array<{ hour: string; count: number }> = [];
  const cursor = new Date(from);
  cursor.setMinutes(0, 0, 0);
  while (cursor <= to) {
    const key = cursor.toISOString().slice(0, 13);
    result.push({ hour: key, count: map.get(key) || 0 });
    cursor.setHours(cursor.getHours() + 1);
  }
  return result;
}

function buildAuthTimeSeries(
  rows: Array<{ hour: string | Date; action: string; status: string; count: number }>,
  from: Date,
  to: Date
): Array<{ hour: string; success: number; failure: number }> {
  const map = new Map<string, { success: number; failure: number }>();
  for (const r of rows) {
    const h = new Date(r.hour).toISOString().slice(0, 13);
    if (!map.has(h)) map.set(h, { success: 0, failure: 0 });
    const entry = map.get(h)!;
    if (r.status === "SUCCESS") entry.success += r.count;
    else entry.failure += r.count;
  }

  const result: Array<{ hour: string; success: number; failure: number }> = [];
  const cursor = new Date(from);
  cursor.setMinutes(0, 0, 0);
  while (cursor <= to) {
    const key = cursor.toISOString().slice(0, 13);
    const entry = map.get(key) || { success: 0, failure: 0 };
    result.push({ hour: key, ...entry });
    cursor.setHours(cursor.getHours() + 1);
  }
  return result;
}
