import { NextResponse } from "next/server";
import { exportMetrics } from "@/lib/metrics";

export const dynamic = "force-dynamic";

/**
 * GET /api/metrics — Prometheus-compatible metrics endpoint.
 *
 * Returns all collected metrics in Prometheus text format.
 *
 * This endpoint should be:
 *   - Protected by network access (not exposed to public)
 *   - Scraped by Prometheus or a similar monitoring tool
 *   - Used for alerting and dashboarding
 *
 * Example Prometheus config:
 *   scrape_configs:
 *     - job_name: 'secure-exchange'
 *       static_configs:
 *         - targets: ['localhost:3000']
 *       metrics_path: '/api/metrics'
 */
export async function GET() {
  const metrics = exportMetrics();

  return new NextResponse(metrics, {
    status: 200,
    headers: {
      "Content-Type": "text/plain; version=0.0.4; charset=utf-8",
      "Cache-Control": "no-cache, no-store, must-revalidate",
    },
  });
}
