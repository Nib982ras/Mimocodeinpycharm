import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireOwner, authErrorResponse } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";
import { deleteCiphertext } from "@/lib/storage";

export const dynamic = "force-dynamic";

/**
 * POST /api/keys/[id]/revoke — cryptographically destroy a key pair (owner only).
 *
 * This is the "remote wipe / cryptographic key destruction" procedure. The
 * encrypted private key material is overwritten with zeros and the key is
 * marked DESTROYED. Documents encrypted with this key can no longer be
 * decrypted by anyone — the data is cryptographically unrecoverable.
 *
 * Optionally, with `purgeDocuments: true`, all ciphertext blobs that used
 * this key for encryption are also deleted from disk.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const owner = await requireOwner();
    const { id } = await params;
    const body = await req.json().catch(() => ({}));
    const { purgeDocuments } = body as { purgeDocuments?: boolean };

    const key = await db.key.findUnique({
      where: { id },
      include: {
        branch: { select: { code: true } },
        receivedDocuments: purgeDocuments ? true : false,
      },
    });
    if (!key) {
      return NextResponse.json({ ok: false, error: "Key not found" }, { status: 404 });
    }

    // Overwrite the encrypted private key material (cryptographic destruction).
    await db.key.update({
      where: { id },
      data: {
        status: "DESTROYED",
        encryptedPrivateKey: "DESTROYED".repeat(64), // overwrite with non-decryptable garbage
        privateIv: "DESTROYED",
        revokedAt: new Date(),
        revokedBy: owner.username,
      },
    });

    let purgedDocs = 0;
    if (purgeDocuments && key.receivedDocuments) {
      for (const doc of key.receivedDocuments as Array<{ id: string; storagePath: string }>) {
        try {
          await deleteCiphertext(doc.storagePath);
          await db.document.update({
            where: { id: doc.id },
            data: { status: "PURGED" },
          });
          purgedDocs++;
        } catch {
          /* best-effort */
        }
      }
    }

    await recordAudit({
      action: "KEY_DESTROY",
      actor: owner.username,
      actorId: owner.id,
      branchId: key.branchId,
      status: "SUCCESS",
      details: {
        branch: key.branch.code,
        keyId: id,
        purpose: key.purpose,
        version: key.version,
        purgedDocuments: purgedDocs,
      },
      ipAddress: req.headers.get("x-forwarded-for") || undefined,
    });

    return NextResponse.json({
      ok: true,
      status: "DESTROYED",
      purgedDocuments: purgedDocs,
    });
  } catch (err) {
    const r = authErrorResponse(err);
    return r ?? NextResponse.json({ ok: false, error: "Failed to destroy key" }, { status: 500 });
  }
}
