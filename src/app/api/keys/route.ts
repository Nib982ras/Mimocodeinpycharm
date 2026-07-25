import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireSecurityAdmin, authErrorResponse } from "@/lib/auth";
import { parsePagination, buildIdCursorWhere, simplePaginatedResponse } from "@/lib/pagination";

export const dynamic = "force-dynamic";

/** GET /api/keys — paginated list of keys (SECURITY_ADMIN+).
 *  Query params: cursor, limit (default 50, max 200), purpose, status, branchId
 */
export async function GET(req: Request) {
  try {
    await requireSecurityAdmin();
    const url = new URL(req.url);
    const pagination = parsePagination(url);
    const purposeFilter = url.searchParams.get("purpose");
    const statusFilter = url.searchParams.get("status");
    const branchFilter = url.searchParams.get("branchId");

    const where: Record<string, unknown> = {};
    if (purposeFilter) where.purpose = purposeFilter;
    if (statusFilter) where.status = statusFilter;
    if (branchFilter) where.branchId = branchFilter;

    const paginatedWhere = buildIdCursorWhere(where, pagination);

    const keys = await db.key.findMany({
      where: paginatedWhere,
      orderBy: [{ createdAt: "desc" }],
      take: pagination.limit + 1,
      include: { branch: { select: { id: true, code: true, name: true, type: true } } },
    });

    const result = simplePaginatedResponse(keys, pagination, undefined, (k) => ({
      id: k.id,
      purpose: k.purpose,
      algorithm: k.algorithm,
      curve: k.curve,
      fingerprint: k.fingerprint,
      status: k.status,
      version: k.version,
      createdAt: k.createdAt.toISOString(),
      rotatedAt: k.rotatedAt?.toISOString() ?? null,
      branch: k.branch,
      publicKeyPem: k.publicKeyPem,
    }));

    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const r = authErrorResponse(err);
    return r ?? NextResponse.json({ ok: false, error: "Failed to list keys" }, { status: 500 });
  }
}
