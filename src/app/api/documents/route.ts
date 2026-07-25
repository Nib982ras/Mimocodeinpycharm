import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { encryptDocument, decryptPrivateKey } from "@/lib/crypto";
import { storeCiphertext } from "@/lib/storage";
import { recordAudit } from "@/lib/audit";
import { hubNotify } from "@/lib/hub-client";
import { requireUser, requireSystemActive, authErrorResponse, ROLE_RANK } from "@/lib/auth";
import { checkBodySize } from "@/lib/body-size-limit";
import { parsePagination, buildIdCursorWhere, simplePaginatedResponse } from "@/lib/pagination";
import { randomUUID } from "crypto";
import fs from "fs";
import os from "os";
import path from "path";

export const dynamic = "force-dynamic";

/** Maximum file size: 100MB (must match body-size-limit.ts) */
const MAX_FILE_SIZE = 100 * 1024 * 1024;

/** GET /api/documents — paginated list of documents visible to the current user.
 *  Query params: cursor, limit (default 50, max 200), branchId, direction
 */
export async function GET(req: Request) {
  try {
    const session = await requireUser();
    const url = new URL(req.url);
    const branchId = url.searchParams.get("branchId");
    const direction = url.searchParams.get("direction"); // "sent" | "received"
    const pagination = parsePagination(url);

    const isAdmin = ROLE_RANK[session.role] >= ROLE_RANK.SECURITY_ADMIN;
    const where: Record<string, unknown> = {};
    if (isAdmin) {
      if (branchId && direction === "sent") where.senderBranchId = branchId;
      else if (branchId && direction === "received") where.recipientBranchId = branchId;
      else if (branchId) {
        where.OR = [{ senderBranchId: branchId }, { recipientBranchId: branchId }];
      }
    } else {
      if (!session.branchId) {
        return NextResponse.json({ ok: true, documents: [], pagination: { nextCursor: null, hasMore: false, limit: pagination.limit, count: 0 } });
      }
      if (direction === "sent") where.senderBranchId = session.branchId;
      else if (direction === "received") where.recipientBranchId = session.branchId;
      else {
        where.OR = [
          { senderBranchId: session.branchId },
          { recipientBranchId: session.branchId },
        ];
      }
    }

    // Apply cursor-based pagination
    const paginatedWhere = buildIdCursorWhere(where, pagination);

    // Fetch limit + 1 to detect if there are more items
    const documents = await db.document.findMany({
      where: paginatedWhere,
      orderBy: { createdAt: "desc" },
      take: pagination.limit + 1,
      include: {
        senderBranch: { select: { id: true, code: true, name: true } },
        recipientBranch: { select: { id: true, code: true, name: true } },
      },
    });

    const result = simplePaginatedResponse(documents, pagination, undefined, (d) => ({
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
    }));

    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const r = authErrorResponse(err);
    return r ?? NextResponse.json({ ok: false, error: "Failed to list documents" }, { status: 500 });
  }
}

/** POST /api/documents — encrypt and store a document for a recipient.
 *  - Enforces body size limit before processing
 *  - Streams upload to a temp file to avoid memory exhaustion
 *  - READONLY: rejected outright (403).
 *  - USER/BRANCH_ADMIN: sender is forced to the user's branch.
 *  - SECURITY_ADMIN+/OWNER: may pick any sender branch.
 *  Enforces system-active + lockdown rules via requireSystemActive() (owner bypasses).
 */
export async function POST(req: Request) {
  // Enforce body size limit BEFORE reading the body
  const sizeError = checkBodySize(req);
  if (sizeError) return sizeError;

  let tempFilePath: string | null = null;

  try {
    const session = await requireSystemActive();

    if (session.role === "READONLY") {
      return NextResponse.json(
        { ok: false, error: "Read-only users cannot send documents" },
        { status: 403 }
      );
    }

    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    const formSenderBranchId = formData.get("senderBranchId") as string | null;
    const recipientBranchId = formData.get("recipientBranchId") as string | null;

    if (!file || !recipientBranchId) {
      return NextResponse.json(
        { ok: false, error: "file and recipientBranchId are required" },
        { status: 400 }
      );
    }

    // Secondary check: verify actual file size after formData parse
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { ok: false, error: `File exceeds maximum size of ${MAX_FILE_SIZE / 1024 / 1024}MB` },
        { status: 413 }
      );
    }

    // Enforce sender identity: regular users always send as their own branch;
    // SECURITY_ADMIN+/OWNER may pick any sender branch.
    const canPickSender = ROLE_RANK[session.role] >= ROLE_RANK.SECURITY_ADMIN;
    const senderBranchId = canPickSender ? (formSenderBranchId ?? null) : session.branchId;
    if (!senderBranchId) {
      return NextResponse.json(
        { ok: false, error: "No sender branch available for this account" },
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

    // Stream upload to a temp file instead of buffering entire file in memory.
    // This prevents OOM crashes for large files.
    tempFilePath = path.join(os.tmpdir(), `doc-upload-${randomUUID()}`);
    const writeStream = fs.createWriteStream(tempFilePath);

    const reader = file.stream().getReader();
    let totalBytes = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        totalBytes += value.length;
        // Abort if file grew beyond limit during streaming (defense-in-depth)
        if (totalBytes > MAX_FILE_SIZE) {
          writeStream.destroy();
          fs.unlinkSync(tempFilePath);
          tempFilePath = null;
          return NextResponse.json(
            { ok: false, error: `File exceeds maximum size of ${MAX_FILE_SIZE / 1024 / 1024}MB` },
            { status: 413 }
          );
        }
        writeStream.write(value);
      }
    } finally {
      writeStream.end();
    }

    // Read the plaintext from the temp file (already validated size, so this is safe)
    const plaintext = fs.readFileSync(tempFilePath);

    // Clean up temp file immediately after reading
    fs.unlinkSync(tempFilePath);
    tempFilePath = null;

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
      actor: session.username,
      branchId: sender.id,
      documentId: doc.id,
      status: "SUCCESS",
      details: {
        fileName: file.name,
        size: plaintext.length,
        sender: sender.code,
        recipient: recipient.code,
        senderKeyId: senderKey.id,
        recipientKeyId: recipientKey.id,
        workflow: "AES-256-GCM + ECDH-P521 + ECDSA-SHA512",
      },
      ipAddress: req.headers.get("x-forwarded-for") || undefined,
    });

    // Notify the exchange hub so the recipient client gets a live delivery event.
    hubNotify({
      type: "document:delivered",
      recipientBranchId: recipient.id,
      senderBranchId: sender.id,
      document: {
        id: doc.id,
        name: doc.name,
        sender: { code: sender.code, name: sender.name },
        recipient: { code: recipient.code, name: recipient.name },
        size: plaintext.length,
      },
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
  } catch (err) {
    // Clean up temp file on error
    if (tempFilePath) {
      try { fs.unlinkSync(tempFilePath); } catch { /* ignore cleanup error */ }
    }
    const r = authErrorResponse(err);
    return r ?? NextResponse.json({ ok: false, error: "Failed to encrypt document" }, { status: 500 });
  }
}
