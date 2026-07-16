import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAdmin, authErrorResponse } from "@/lib/auth";

export const dynamic = "force-dynamic";

/** GET /api/keys — list all keys (admin only). */
export async function GET() {
  try {
    await requireAdmin();
    const keys = await db.key.findMany({
      orderBy: [{ createdAt: "desc" }],
      include: { branch: { select: { id: true, code: true, name: true, type: true } } },
    });
    return NextResponse.json({
      ok: true,
      keys: keys.map((k) => ({
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
      })),
    });
  } catch (err) {
    const r = authErrorResponse(err);
    return r ?? NextResponse.json({ ok: false, error: "Failed to list keys" }, { status: 500 });
  }
}
