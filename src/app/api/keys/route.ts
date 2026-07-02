import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { generateEcKeyPair, encryptPrivateKey, type KeyPairPem } from "@/lib/crypto";
import { recordAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

/** GET /api/keys — list all keys with branch info. */
export async function GET() {
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
      // Public key (safe to expose)
      publicKeyPem: k.publicKeyPem,
    })),
  });
}
