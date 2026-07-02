import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/** GET /api/documents/[id] — full metadata for a single secure package. */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const doc = await db.document.findUnique({
    where: { id },
    include: {
      senderBranch: { select: { id: true, code: true, name: true, type: true } },
      recipientBranch: { select: { id: true, code: true, name: true, type: true } },
      senderKey: { select: { id: true, purpose: true, version: true, fingerprint: true } },
      recipientKey: { select: { id: true, purpose: true, version: true, fingerprint: true } },
    },
  });

  if (!doc) {
    return NextResponse.json({ ok: false, error: "Document not found" }, { status: 404 });
  }

  return NextResponse.json({
    ok: true,
    document: {
      id: doc.id,
      name: doc.name,
      mimeType: doc.mimeType,
      originalSize: doc.originalSize,
      status: doc.status,
      packageVersion: doc.packageVersion,
      documentHash: doc.documentHash,
      nonce: doc.nonce,
      sender: doc.senderBranch,
      recipient: doc.recipientBranch,
      senderKey: doc.senderKey,
      recipientKey: doc.recipientKey,
      createdAt: doc.createdAt.toISOString(),
      decryptedAt: doc.decryptedAt?.toISOString() ?? null,
    },
  });
}
