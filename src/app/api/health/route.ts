import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * GET /api/health — Health check endpoint for load balancers and monitoring.
 *
 * Returns:
 *   - 200: System is healthy
 *   - 503: System is degraded or unhealthy
 *
 * Checks:
 *   - Database connectivity
 *   - System state (active/lockdown)
 *   - Uptime
 *   - Memory usage
 */
export async function GET() {
  const checks: Record<string, { status: string; latencyMs?: number }> = {};
  let overall = "healthy";

  // Database check
  const dbStart = Date.now();
  try {
    await db.$queryRaw`SELECT 1`;
    checks.database = { status: "ok", latencyMs: Date.now() - dbStart };
  } catch (err) {
    checks.database = { status: "error", latencyMs: Date.now() - dbStart };
    overall = "unhealthy";
  }

  // System state check
  try {
    const state = await db.systemState.findUnique({ where: { id: "singleton" } });
    checks.system = {
      status: state ? (state.active ? "active" : "deactivated") : "not_initialized",
    };
    if (state?.lockdown) {
      checks.system.status = "lockdown";
      if (overall !== "unhealthy") overall = "degraded";
    }
  } catch {
    checks.system = { status: "error" };
    overall = "unhealthy";
  }

  // Memory usage
  const mem = process.memoryUsage();
  checks.memory = {
    status: "ok",
    // Include memory stats for monitoring
    ...{
      heapUsedMB: Math.round(mem.heapUsed / 1024 / 1024),
      heapTotalMB: Math.round(mem.heapTotal / 1024 / 1024),
      rssMB: Math.round(mem.rss / 1024 / 1024),
    },
  };

  // Warn if memory usage is high (>500MB heap)
  if (mem.heapUsed > 500 * 1024 * 1024) {
    checks.memory.status = "warning";
    if (overall === "healthy") overall = "degraded";
  }

  const response = {
    ok: overall === "healthy",
    status: overall,
    timestamp: new Date().toISOString(),
    uptime: Math.floor(process.uptime()),
    version: process.env.npm_package_version || "unknown",
    checks,
  };

  return NextResponse.json(response, {
    status: overall === "unhealthy" ? 503 : 200,
  });
}
