import { NextResponse } from "next/server";
import { exportMetrics } from "@/lib/metrics";
import { requireSecurityAdmin, authErrorResponse } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * GET /api/metrics — Prometheus-compatible metrics endpoint.
 *
 * Requires SECURITY_ADMIN authentication.
 * Returns all collected metrics in Prometheus text format.
 *
 * Example Prometheus config:
 *   scrape_configs:
 *     - job_name: 'secure-exchange'
 *       static_configs:
 *         - targets: ['localhost:3000']
 *       metrics_path: '/api/metrics'
 *       bearer_token: '<SECURITY_ADMIN session token>'
 */
export async function GET() {
  try {
    await requireSecurityAdmin();

    const metrics = exportMetrics();

    return new NextResponse(metrics, {
      status: 200,
      headers: {
        "Content-Type": "text/plain; version=0.0.4; charset=utf-8",
        "Cache-Control": "no-cache, no-store, must-revalidate",
      },
    });
  } catch (err) {
    const r = authErrorResponse(err);
    return r ?? new NextResponse("Internal Server Error", { status: 500 });
  }
}
