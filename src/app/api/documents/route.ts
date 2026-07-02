import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { encryptDocument, decryptPrivateKey } from "@/lib/crypto";
import { storeCiphertext } from "@/lib/storage";
import { recordAudit } from "@/lib/audit";
import { randomUUID } from "crypto";

export const dynamic = "force-dynamic";

/** GET /api/documents — list documents with sender/recipient info. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const branchId = url.searchParams.get("branchId");
  const direction = url.searchParams.get("direction"); // "sent" | "received"

  const where: Record<string, unknown> = {};
  if (branchId && direction === "sent") where.senderBranchId = branchId;
  else if (branchId && direction === "received") where.recipientBranchId = branchId;
  else if (branchId) {
    where.OR = [{ senderBranchId: branchId }, { recipientBranchId: branchId }];
  }

  const documents = await db.document.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: 100,
    include: {
      senderBranch: { select: { id: true, code: true, name: true } },
      recipientBranch: { select: { id: true, code: true, name: true } },
    },
  });

  return NextResponse.json({
    ok: true,
    documents: documents.map((d) => ({
      id: d.id,
      name: d.name,
      mimeType: d.mimeType,
      originalSize: d.originalSize,
      status: d.status,
      packageVersion: d.packageVersion,
      documentHash: d.documentHash,
      nonce: d.nonce,
      sender: d.senderBranch,
      recipient: d.recipientBranch,
      createdAt: d.createdAt.toISOString(),
      decryptedAt: d.decryptedAt?.toISOString() ?? null,
    })),
  });
}

/** POST /api/documents — encrypt and store a document for a recipient. */
export async function POST(req: Request) {
  const formData = await req.formData();
  const file = formData.get("file") as File | null;
  const senderBranchId = formData.get("senderBranchId") as string | null;
  const recipientBranchId = formData.get("recipientBranchId") as string | null;

  if (!file || !senderBranchId || !recipientBranchId) {
    return NextResponse.json(
      { ok: false, error: "file, senderBranchId and recipientBranchId are required" },
      { status: 400 }
    );
  }
  if (senderBranchId === recipientBranchId) {
    return NextResponse.json(
      { ok: false, error: "Sender and recipient must be different branches" },
      { status: 400 }
    );
  }

  const sender = await db.branch.findUnique({
    where: { id: senderBranchId },
    include: { keys: { where: { status: "ACTIVE", purpose: "SIGNING" } } },
  });
  const recipient = await db.branch.findUnique({
    where: { id: recipientBranchId },
    include: { keys: { where: { status: "ACTIVE", purpose: "ENCRYPTION" } } },
  });

  if (!sender || sender.keys.length === 0) {
    return NextResponse.json({ ok: false, error: "Sender has no active signing key" }, { status: 400 });
  }
  if (!recipient || recipient.keys.length === 0) {
    return NextResponse.json({ ok: false, error: "Recipient has no active encryption key" }, { status: 400 });
  }

  const senderKey = sender.keys[0];
  const recipientKey = recipient.keys[0];

  // Recover the sender's signing private key from the (master-key-encrypted) store.
  const senderPrivPem = decryptPrivateKey(senderKey.encryptedPrivateKey, senderKey.privateIv);

  // Read the uploaded file into memory (reference build; large files would stream).
  const arrayBuffer = await file.arrayBuffer();
  const plaintext = Buffer.from(arrayBuffer);

  // Run the full hybrid encryption workflow.
  const enc = encryptDocument(plaintext, senderPrivPem, recipientKey.publicKeyPem);

  const docId = randomUUID();
  const storagePath = storeCiphertext(docId, enc.ciphertext);

  const doc = await db.document.create({
    data: {
      id: docId,
      name: file.name,
      mimeType: file.type || "application/octet-stream",
      originalSize: plaintext.length,
      senderBranchId: sender.id,
      recipientBranchId: recipient.id,
      storagePath,
      ephemeralPublicKey: enc.ephemeralPublicKeyDer.toString("base64"),
      encryptedSessionKey: enc.encryptedSessionKey.toString("base64"),
      sessionIv: enc.sessionIv.toString("base64"),
      sessionAuthTag: enc.sessionAuthTag.toString("base64"),
      docIv: enc.docIv.toString("base64"),
      authTag: enc.authTag.toString("base64"),
      signature: enc.signature.toString("base64"),
      senderKeyId: senderKey.id,
      recipientKeyId: recipientKey.id,
      documentHash: enc.documentHash,
      nonce: enc.nonce,
      packageVersion: "1.0",
      status: "DELIVERED",
    },
  });

  await recordAudit({
    action: "UPLOAD",
    actor: sender.code,
    branchId: sender.id,
    documentId: doc.id,
    status: "SUCCESS",
    details: {
      fileName: file.name,
      size: plaintext.length,
      recipient: recipient.code,
      senderKeyId: senderKey.id,
      recipientKeyId: recipientKey.id,
      workflow: "AES-256-GCM + ECDH-P521 + ECDSA-SHA512",
    },
    ipAddress: req.headers.get("x-forwarded-for") || undefined,
  });

  return NextResponse.json({
    ok: true,
    document: {
      id: doc.id,
      name: doc.name,
      originalSize: doc.originalSize,
      documentHash: doc.documentHash,
      packageVersion: doc.packageVersion,
      sender: { code: sender.code, name: sender.name },
      recipient: { code: recipient.code, name: recipient.name },
      createdAt: doc.createdAt.toISOString(),
    },
  });
}
