import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/** GET /api/dashboard — aggregate statistics for the dashboard. */
export async function GET() {
  const [
    branchCount,
    documentCount,
    keyCount,
    auditCount,
    activeKeys,
    rotatedKeys,
    revokedKeys,
    decryptedDocs,
    branchesByType,
    recentAudit,
    recentDocs,
  ] = await Promise.all([
    db.branch.count(),
    db.document.count(),
    db.key.count(),
    db.auditLog.count(),
    db.key.count({ where: { status: "ACTIVE" } }),
    db.key.count({ where: { status: "ROTATED" } }),
    db.key.count({ where: { status: "REVOKED" } }),
    db.document.count({ where: { status: "DECRYPTED" } }),
    db.branch.groupBy({ by: ["type"], _count: true }),
    db.auditLog.findMany({ take: 8, orderBy: { createdAt: "desc" } }),
    db.document.findMany({
      take: 6,
      orderBy: { createdAt: "desc" },
      include: {
        senderBranch: { select: { code: true, name: true } },
        recipientBranch: { select: { code: true, name: true } },
      },
    }),
  ]);

  // Build the full branch hierarchy tree.
  const branches = await db.branch.findMany({
    orderBy: { type: "asc" },
    include: { _count: { select: { keys: true, sentDocs: true, receivedDocs: true } } },
  });

  const typeMap: Record<string, number> = {};
  branchesByType.forEach((t) => (typeMap[t.type] = t._count));

  return NextResponse.json({
    ok: true,
    stats: {
      branches: branchCount,
      documents: documentCount,
      keys: keyCount,
      auditEvents: auditCount,
      activeKeys,
      rotatedKeys,
      revokedKeys,
      decryptedDocs,
    },
    branchesByType: typeMap,
    hierarchy: buildHierarchy(branches),
    recentAudit: recentAudit.map((a) => ({
      id: a.id,
      action: a.action,
      actor: a.actor,
      status: a.status,
      details: a.details,
      createdAt: a.createdAt.toISOString(),
    })),
    recentDocs: recentDocs.map((d) => ({
      id: d.id,
      name: d.name,
      originalSize: d.originalSize,
      status: d.status,
      sender: d.senderBranch,
      recipient: d.recipientBranch,
      createdAt: d.createdAt.toISOString(),
    })),
  });
}

interface BranchNode {
  id: string;
  code: string;
  name: string;
  type: string;
  region: string | null;
  keyCount: number;
  sentCount: number;
  receivedCount: number;
  children: BranchNode[];
}

function buildHierarchy(
  branches: Array<{
    id: string;
    code: string;
    name: string;
    type: string;
    region: string | null;
    parentId: string | null;
    _count: { keys: number; sentDocs: number; receivedDocs: number };
  }>
): BranchNode[] {
  const map = new Map<string, BranchNode>();
  branches.forEach((b) => {
    map.set(b.id, {
      id: b.id,
      code: b.code,
      name: b.name,
      type: b.type,
      region: b.region,
      keyCount: b._count.keys,
      sentCount: b._count.sentDocs,
      receivedCount: b._count.receivedDocs,
      children: [],
    });
  });

  const roots: BranchNode[] = [];
  branches.forEach((b) => {
    const node = map.get(b.id)!;
    if (b.parentId && map.has(b.parentId)) {
      map.get(b.parentId)!.children.push(node);
    } else {
      roots.push(node);
    }
  });
  return roots;
}
