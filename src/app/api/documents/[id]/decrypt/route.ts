import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { decryptDocument, decryptPrivateKey } from "@/lib/crypto";
import { readCiphertext } from "@/lib/storage";
import { recordAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

/**
 * POST /api/documents/[id]/decrypt
 *
 * Performs the full decryption workflow:
 *  1. Load recipient's encryption private key (decrypted via master key)
 *  2. ECDH with the per-document ephemeral public key -> HKDF -> KEK
 *  3. Decrypt the session key (AES-256-GCM)
 *  4. Decrypt the document (AES-256-GCM, auth tag verified)
 *  5. Verify the ECDSA-SHA512 signature over the ciphertext
 *  6. Verify the SHA-512 document integrity hash
 *
 * Returns the decrypted file bytes plus the verification results.
 */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const doc = await db.document.findUnique({
    where: { id },
    include: {
      recipientKey: true,
      senderKey: true,
      recipientBranch: { select: { id: true, code: true, name: true } },
      senderBranch: { select: { id: true, code: true, name: true } },
    },
  });

  if (!doc) {
    return NextResponse.json({ ok: false, error: "Document not found" }, { status: 404 });
  }

  try {
    // Recipient's encryption private key (stored encrypted at rest).
    const recipientPrivPem = decryptPrivateKey(
      doc.recipientKey.encryptedPrivateKey,
      doc.recipientKey.privateIv
    );
    // Sender's signing public key (reconstructed from the stored PEM).
    const senderPubPem = doc.senderKey.publicKeyPem;

    const ciphertext = readCiphertext(doc.storagePath);

    const result = decryptDocument(
      ciphertext,
      Buffer.from(doc.ephemeralPublicKey, "base64"),
      Buffer.from(doc.encryptedSessionKey, "base64"),
      Buffer.from(doc.sessionIv, "base64"),
      Buffer.from(doc.sessionAuthTag, "base64"),
      Buffer.from(doc.docIv, "base64"),
      Buffer.from(doc.authTag, "base64"),
      Buffer.from(doc.signature, "base64"),
      recipientPrivPem,
      senderPubPem,
      doc.documentHash
    );

    await db.document.update({
      where: { id },
      data: { status: "DECRYPTED", decryptedAt: new Date() },
    });

    await recordAudit({
      action: "DOWNLOAD",
      actor: doc.recipientBranch.code,
      branchId: doc.recipientBranch.id,
      documentId: doc.id,
      status: result.signatureValid && result.documentHashValid ? "SUCCESS" : "WARNING",
      details: {
        fileName: doc.name,
        sender: doc.senderBranch.code,
        signatureValid: result.signatureValid,
        documentHashValid: result.documentHashValid,
        decryptedBytes: result.plaintext.length,
      },
    });

    // Return the file plus verification metadata in headers.
    return new NextResponse(result.plaintext, {
      status: 200,
      headers: {
        "Content-Type": doc.mimeType || "application/octet-stream",
        "Content-Disposition": `attachment; filename="${encodeURIComponent(doc.name)}"`,
        "X-Signature-Valid": String(result.signatureValid),
        "X-Document-Hash-Valid": String(result.documentHashValid),
        "X-Document-Hash": result.documentHash,
        "X-Workflow": "ECDH-P521 + HKDF-SHA256 + AES-256-GCM + ECDSA-SHA512",
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Decryption failed";
    await recordAudit({
      action: "DOWNLOAD",
      actor: doc.recipientBranch.code,
      branchId: doc.recipientBranch.id,
      documentId: doc.id,
      status: "FAILURE",
      details: { error: message, fileName: doc.name },
    });
    return NextResponse.json(
      { ok: false, error: message, hint: "This may indicate tampering or a key mismatch." },
      { status: 500 }
    );
  }
}
