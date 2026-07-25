import { NextResponse } from "next/server";
import { requireSecurityAdmin, authErrorResponse } from "@/lib/auth";
import { db } from "@/lib/db";
import { systemStateCache, branchCache, dashboardCache } from "@/lib/cache";
import { checkDatabaseHealth } from "@/lib/db";
import { getJobStatus } from "@/lib/jobs";

export const dynamic = "force-dynamic";

/**
 * GET /api/monitoring — System monitoring summary.
 *
 * Provides a comprehensive overview of system health and performance.
 * Requires SECURITY_ADMIN+ authentication.
 *
 * Returns:
 *   - System status (active/lockdown)
 *   - Database health and latency
 *   - User statistics
 *   - Document statistics
 *   - Key statistics
 *   - Audit log statistics
 *   - Cache statistics
 *   - Memory usage
 *   - Uptime
 */
export async function GET() {
  try {
    await requireSecurityAdmin();

    // Database health
    const dbHealth = await checkDatabaseHealth();

    // System state
    const systemState = await db.systemState.findUnique({ where: { id: "singleton" } });

    // User statistics
    const userStats = await db.user.groupBy({
      by: ["status"],
      _count: { id: true },
    });

    // Document statistics
    const docStats = await db.document.groupBy({
      by: ["status"],
      _count: { id: true },
      _sum: { originalSize: true },
    });

    // Key statistics
    const keyStats = await db.key.groupBy({
      by: ["status", "purpose"],
      _count: { id: true },
    });

    // Audit log statistics (last 24 hours)
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const auditStats = await db.auditLog.groupBy({
      by: ["status"],
      where: { createdAt: { gte: oneDayAgo } },
      _count: { id: true },
    });

    // Recent activity (last 10 audit events)
    const recentActivity = await db.auditLog.findMany({
      orderBy: { createdAt: "desc" },
      take: 10,
      select: {
        action: true,
        actor: true,
        status: true,
        createdAt: true,
      },
    });

    // Memory usage
    const mem = process.memoryUsage();

    return NextResponse.json({
      ok: true,
      timestamp: new Date().toISOString(),
      uptime: Math.floor(process.uptime()),
      system: {
        active: systemState?.active ?? true,
        lockdown: systemState?.lockdown ?? false,
        lockdownReason: systemState?.lockdownReason,
      },
      database: {
        status: dbHealth.status,
        latencyMs: dbHealth.latencyMs,
      },
      users: {
        total: userStats.reduce((sum, s) => sum + s._count.id, 0),
        byStatus: Object.fromEntries(userStats.map((s) => [s.status, s._count.id])),
      },
      documents: {
        total: docStats.reduce((sum, s) => sum + s._count.id, 0),
        totalSizeBytes: docStats.reduce((sum, s) => sum + (s._sum.originalSize || 0), 0),
        byStatus: Object.fromEntries(docStats.map((s) => [s.status, s._count.id])),
      },
      keys: {
        total: keyStats.reduce((sum, s) => sum + s._count.id, 0),
        byStatus: Object.fromEntries(
          keyStats.map((s) => [`${s.status}_${s.purpose}`, s._count.id])
        ),
      },
      audit: {
        last24h: auditStats.reduce((sum, s) => sum + s._count.id, 0),
        byStatus: Object.fromEntries(auditStats.map((s) => [s.status, s._count.id])),
      },
      recentActivity,
      cache: {
        systemState: systemStateCache.getStats(),
        branch: branchCache.getStats(),
        dashboard: dashboardCache.getStats(),
      },
      memory: {
        heapUsedMB: Math.round(mem.heapUsed / 1024 / 1024),
        heapTotalMB: Math.round(mem.heapTotal / 1024 / 1024),
        rssMB: Math.round(mem.rss / 1024 / 1024),
        externalMB: Math.round(mem.external / 1024 / 1024),
      },
      backgroundJobs: getJobStatus(),
    });
  } catch (err) {
    const r = authErrorResponse(err);
    return r ?? NextResponse.json(
      { ok: false, error: "Failed to load monitoring data" },
      { status: 500 }
    );
  }
}
