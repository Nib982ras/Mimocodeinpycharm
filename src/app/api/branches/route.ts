import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  generateEcKeyPair,
  encryptPrivateKey,
  type KeyPairPem,
} from "@/lib/crypto";
import { recordAudit } from "@/lib/audit";
import { hubNotify } from "@/lib/hub-client";
import { requireUser, requireSecurityAdmin, authErrorResponse } from "@/lib/auth";

export const dynamic = "force-dynamic";

/** GET /api/branches — list all branches (any authenticated user). */
export async function GET() {
  try {
    await requireUser();
    const branches = await db.branch.findMany({
      orderBy: [{ type: "asc" }, { code: "asc" }],
      include: {
        parent: { select: { id: true, code: true, name: true } },
        _count: { select: { keys: true, sentDocs: true, receivedDocs: true, children: true } },
        keys: {
          where: { status: "ACTIVE" },
          select: { id: true, purpose: true, algorithm: true, fingerprint: true, version: true, createdAt: true },
        },
      },
    });
    return NextResponse.json({ ok: true, branches });
  } catch (err) {
    const r = authErrorResponse(err);
    return r ?? NextResponse.json({ ok: false, error: "Failed to list branches" }, { status: 500 });
  }
}

/** POST /api/branches — create a new branch and provision its ECC key pairs (SECURITY_ADMIN+). */
export async function POST(req: Request) {
  try {
    const admin = await requireSecurityAdmin();
    const body = await req.json().catch(() => ({}));
    const { name, code, type, region, parentId } = body as {
      name?: string;
      code?: string;
      type?: string;
      region?: string;
      parentId?: string;
    };

    if (!name || !code || !type) {
      return NextResponse.json(
        { ok: false, error: "name, code and type are required" },
        { status: 400 }
      );
    }
    const validTypes = ["HEADQUARTERS", "REGIONAL", "DEPARTMENT", "SUB_BRANCH"];
    if (!validTypes.includes(type)) {
      return NextResponse.json({ ok: false, error: "Invalid branch type" }, { status: 400 });
    }

    const existing = await db.branch.findUnique({ where: { code } });
    if (existing) {
      return NextResponse.json({ ok: false, error: "Branch code already exists" }, { status: 409 });
    }

    const branch = await db.branch.create({
      data: {
        name,
        code,
        type,
        region: region || null,
        parentId: parentId || null,
      },
    });

    // Provision ENCRYPTION (ECDH) and SIGNING (ECDSA) key pairs.
    for (const purpose of ["ENCRYPTION", "SIGNING"] as const) {
      const kp: KeyPairPem = generateEcKeyPair();
      const enc = encryptPrivateKey(kp.privateKeyPem);
      await db.key.create({
        data: {
          branchId: branch.id,
          purpose,
          algorithm: purpose === "ENCRYPTION" ? "ECDH-P521" : "ECDSA-P521-SHA512",
          curve: "secp521r1",
          publicKeyPem: kp.publicKeyPem,
          encryptedPrivateKey: enc.ciphertext,
          privateIv: enc.iv,
          fingerprint: kp.fingerprint,
          status: "ACTIVE",
          version: 1,
        },
      });
    }

    await recordAudit({
      action: "BRANCH_CREATE",
      actor: admin.username,
      branchId: branch.id,
      status: "SUCCESS",
      details: { code, name, type, region, parentId },
    });

    // Broadcast the new node to all connected clients so the topology updates live.
    hubNotify({
      type: "branch:created",
      branch: { id: branch.id, code: branch.code, name: branch.name, type: branch.type },
    });

    return NextResponse.json({ ok: true, branch });
  } catch (err) {
    const r = authErrorResponse(err);
    return r ?? NextResponse.json({ ok: false, error: "Failed to create branch" }, { status: 500 });
  }
}
