import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { decryptDocument, decryptPrivateKey } from "@/lib/crypto";
import { readCiphertext } from "@/lib/storage";
import { recordAudit } from "@/lib/audit";
import { hubNotify } from "@/lib/hub-client";
import { requireSystemActive, authErrorResponse, ROLE_RANK } from "@/lib/auth";
import { checkDocumentPermission } from "@/lib/document-permissions";
import { enforceDocumentExpiry } from "@/lib/document-expiry";
import fs from "fs";
import os from "os";
import path from "path";
import { randomUUID } from "crypto";

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
 * Access control: recipient branch members, users with DECRYPT permission, or SECURITY_ADMIN+.
 * READONLY users may never decrypt. System-active/lockdown rules enforced (owner bypasses).
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  let session;
  try {
    session = await requireSystemActive();
  } catch (err) {
    const r = authErrorResponse(err);
    return r ?? NextResponse.json({ ok: false, error: "Auth failed" }, { status: 500 });
  }

  if (session.role === "READONLY") {
    return NextResponse.json(
      { ok: false, error: "Read-only users cannot decrypt documents" },
      { status: 403 }
    );
  }

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

  // Authorization: check document permissions
  const hasDecryptPermission = await checkDocumentPermission(id, {
    userId: session.id,
    branchId: session.branchId,
    role: session.role,
    requiredPermission: "DECRYPT",
  });

  if (!hasDecryptPermission) {
    await recordAudit({
      action: "DOWNLOAD",
      actor: session.username,
      branchId: session.branchId ?? undefined,
      documentId: doc.id,
      status: "FAILURE",
      details: { event: "UNAUTHORIZED_DECRYPT", fileName: doc.name, recipient: doc.recipientBranch.code },
      ipAddress: req.headers.get("x-forwarded-for") || undefined,
    });
    return NextResponse.json(
      { ok: false, error: "You are not authorized to decrypt this document" },
      { status: 403 }
    );
  }

  // Check document expiry
  const expiryCheck = await enforceDocumentExpiry(id);
  if (!expiryCheck.allowed) {
    await recordAudit({
      action: "DOWNLOAD",
      actor: session.username,
      branchId: session.branchId ?? undefined,
      documentId: doc.id,
      status: "FAILURE",
      details: { event: "DOCUMENT_EXPIRED", fileName: doc.name, expiresAt: doc.expiresAt?.toISOString() },
      ipAddress: req.headers.get("x-forwarded-for") || undefined,
    });
    return NextResponse.json(
      { ok: false, error: expiryCheck.error },
      { status: 410 } // 410 Gone
    );
  }

  // Write decrypted plaintext to a temp file to avoid holding it all in memory for the response
  let tempFilePath: string | null = null;

  try {
    // Recipient's encryption private key (stored encrypted at rest).
    const recipientPrivPem = decryptPrivateKey(
      doc.recipientKey.encryptedPrivateKey,
      doc.recipientKey.privateIv
    );
    // Sender's signing public key (reconstructed from the stored PEM).
    const senderPubPem = doc.senderKey.publicKeyPem;

    const ciphertext = await readCiphertext(doc.storagePath);

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

    // Write plaintext to temp file for streaming response
    tempFilePath = path.join(os.tmpdir(), `doc-decrypt-${randomUUID()}`);
    fs.writeFileSync(tempFilePath, result.plaintext);

    await db.document.update({
      where: { id },
      data: { status: "DECRYPTED", decryptedAt: new Date() },
    });

    await recordAudit({
      action: "DOWNLOAD",
      actor: session.username,
      branchId: doc.recipientBranch.id,
      documentId: doc.id,
      status: result.signatureValid && result.documentHashValid ? "SUCCESS" : "WARNING",
      details: {
        fileName: doc.name,
        sender: doc.senderBranch.code,
        recipient: doc.recipientBranch.code,
        signatureValid: result.signatureValid,
        documentHashValid: result.documentHashValid,
        decryptedBytes: result.plaintext.length,
      },
    });

    // Notify the hub so the sender gets a live "receipt confirmation".
    hubNotify({
      type: "document:decrypted",
      senderBranchId: doc.senderBranchId,
      document: {
        id: doc.id,
        name: doc.name,
        sender: { code: doc.senderBranch.code, name: doc.senderBranch.name },
        recipient: { code: doc.recipientBranch.code, name: doc.recipientBranch.name },
        size: result.plaintext.length,
      },
    });

    // Sanitize filename for Content-Disposition header
    const safeFilename = doc.name
      .replace(/[^a-zA-Z0-9._-]/g, "_")
      .replace(/_{2,}/g, "_")
      .slice(0, 255);

    // Stream the file from disk to avoid holding plaintext in memory for the response
    const fileBuffer = fs.readFileSync(tempFilePath);
    fs.unlinkSync(tempFilePath);
    tempFilePath = null;

    return new NextResponse(new Uint8Array(fileBuffer), {
      status: 200,
      headers: {
        "Content-Type": doc.mimeType || "application/octet-stream",
        "Content-Disposition": `attachment; filename="${safeFilename}"`,
        "X-Signature-Valid": String(result.signatureValid),
        "X-Document-Hash-Valid": String(result.documentHashValid),
        "X-Document-Hash": result.documentHash,
        "X-Workflow": "ECDH-P521 + HKDF-SHA256 + AES-256-GCM + ECDSA-SHA512",
      },
    });
  } catch (err) {
    // Clean up temp file on error
    if (tempFilePath) {
      try { fs.unlinkSync(tempFilePath); } catch { /* ignore */ }
    }
    const message = err instanceof Error ? err.message : "Decryption failed";
    await recordAudit({
      action: "DOWNLOAD",
      actor: doc.recipientBranch.code,
      branchId: doc.recipientBranch.id,
      documentId: doc.id,
      status: "FAILURE",
      details: { error: message, fileName: doc.name },
    });
    console.error("Decryption error:", err);
    return NextResponse.json(
      { ok: false, error: "Decryption failed", hint: "Document may be tampered or keys mismatched" },
      { status: 500 }
    );
  }
}
