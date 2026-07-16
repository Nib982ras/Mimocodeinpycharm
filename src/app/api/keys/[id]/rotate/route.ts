import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { generateEcKeyPair, encryptPrivateKey, type KeyPairPem } from "@/lib/crypto";
import { recordAudit } from "@/lib/audit";
import { requireAdmin, authErrorResponse } from "@/lib/auth";

export const dynamic = "force-dynamic";

/** POST /api/keys/[id]/rotate — rotate an existing key pair (admin only).
 *  Marks the old key as ROTATED and provisions a new ACTIVE key (v+1).
 */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const admin = await requireAdmin();
    const { id } = await params;

    const oldKey = await db.key.findUnique({
      where: { id },
      include: { branch: { select: { id: true, code: true } } },
    });
    if (!oldKey) {
      return NextResponse.json({ ok: false, error: "Key not found" }, { status: 404 });
    }

    // Mark the old key as rotated.
    await db.key.update({
      where: { id },
      data: { status: "ROTATED", rotatedAt: new Date() },
    });

    // Provision a new active key with an incremented version.
    const kp: KeyPairPem = generateEcKeyPair();
    const enc = encryptPrivateKey(kp.privateKeyPem);
    const newKey = await db.key.create({
      data: {
        branchId: oldKey.branchId,
        purpose: oldKey.purpose,
        algorithm: oldKey.algorithm,
        curve: oldKey.curve,
        publicKeyPem: kp.publicKeyPem,
        encryptedPrivateKey: enc.ciphertext,
        privateIv: enc.iv,
        fingerprint: kp.fingerprint,
        status: "ACTIVE",
        version: oldKey.version + 1,
      },
    });

    await recordAudit({
      action: "KEY_ROTATE",
      actor: admin.username,
      branchId: oldKey.branchId,
      status: "SUCCESS",
      details: {
        branch: oldKey.branch.code,
        oldKeyId: oldKey.id,
        newKeyId: newKey.id,
        purpose: oldKey.purpose,
        oldVersion: oldKey.version,
        newVersion: newKey.version,
      },
    });

    return NextResponse.json({
      ok: true,
      oldKeyId: oldKey.id,
      newKey: {
        id: newKey.id,
        purpose: newKey.purpose,
        version: newKey.version,
        fingerprint: newKey.fingerprint,
        createdAt: newKey.createdAt.toISOString(),
      },
    });
  } catch (err) {
    const r = authErrorResponse(err);
    return r ?? NextResponse.json({ ok: false, error: "Failed to rotate key" }, { status: 500 });
  }
}
