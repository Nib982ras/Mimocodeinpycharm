import { db } from "@/lib/db";
import {
  generateEcKeyPair,
  encryptPrivateKey,
  type KeyPairPem,
} from "@/lib/crypto";
import { recordAudit } from "@/lib/audit";

/**
 * Seed the system with a hierarchical organization matching the recommended
 * topology from 02_NETWORK_TOPOLOGY.md:
 *
 *   Headquarters (Root CA)
 *     ├─ Regional A (North America)
 *     │    ├─ Dept A1 ─ Sub-branch A1
 *     │    └─ Dept A2 ─ Sub-branch A2
 *     ├─ Regional B (Europe)
 *     │    ├─ Dept B1 ─ Sub-branch B1
 *     │    └─ Dept B2
 *     └─ Regional C (Asia-Pacific)
 *          ├─ Dept C1 ─ Sub-branch C1
 *          └─ Dept C2
 *
 * Each branch receives two ECC P-521 key pairs: one for ECDH (ENCRYPTION) and
 * one for ECDSA (SIGNING). Private keys are encrypted at rest with the master key.
 */

interface BranchSeed {
  code: string;
  name: string;
  type: "HEADQUARTERS" | "REGIONAL" | "DEPARTMENT" | "SUB_BRANCH";
  region?: string;
  parentCode?: string;
}

const BRANCH_SEEDS: BranchSeed[] = [
  { code: "HQ", name: "Headquarters", type: "HEADQUARTERS", region: "Global" },
  { code: "REG-A", name: "Regional A — North America", type: "REGIONAL", region: "North America", parentCode: "HQ" },
  { code: "REG-B", name: "Regional B — Europe", type: "REGIONAL", region: "Europe", parentCode: "HQ" },
  { code: "REG-C", name: "Regional C — Asia-Pacific", type: "REGIONAL", region: "Asia-Pacific", parentCode: "HQ" },
  { code: "DEPT-A1", name: "Department A1", type: "DEPARTMENT", region: "North America", parentCode: "REG-A" },
  { code: "DEPT-A2", name: "Department A2", type: "DEPARTMENT", region: "North America", parentCode: "REG-A" },
  { code: "DEPT-B1", name: "Department B1", type: "DEPARTMENT", region: "Europe", parentCode: "REG-B" },
  { code: "DEPT-B2", name: "Department B2", type: "DEPARTMENT", region: "Europe", parentCode: "REG-B" },
  { code: "DEPT-C1", name: "Department C1", type: "DEPARTMENT", region: "Asia-Pacific", parentCode: "REG-C" },
  { code: "DEPT-C2", name: "Department C2", type: "DEPARTMENT", region: "Asia-Pacific", parentCode: "REG-C" },
  { code: "SUB-A1", name: "Sub-branch A1", type: "SUB_BRANCH", region: "North America", parentCode: "DEPT-A1" },
  { code: "SUB-A2", name: "Sub-branch A2", type: "SUB_BRANCH", region: "North America", parentCode: "DEPT-A2" },
  { code: "SUB-B1", name: "Sub-branch B1", type: "SUB_BRANCH", region: "Europe", parentCode: "DEPT-B1" },
  { code: "SUB-C1", name: "Sub-branch C1", type: "SUB_BRANCH", region: "Asia-Pacific", parentCode: "DEPT-C1" },
];

function makeKeyPairRecord(branchId: string, purpose: "ENCRYPTION" | "SIGNING"): {
  branchId: string;
  purpose: string;
  algorithm: string;
  curve: string;
  publicKeyPem: string;
  encryptedPrivateKey: string;
  privateIv: string;
  fingerprint: string;
  status: string;
  version: number;
} {
  const kp: KeyPairPem = generateEcKeyPair();
  const enc = encryptPrivateKey(kp.privateKeyPem);
  return {
    branchId,
    purpose,
    algorithm: purpose === "ENCRYPTION" ? "ECDH-P521" : "ECDSA-P521-SHA512",
    curve: "secp521r1",
    publicKeyPem: kp.publicKeyPem,
    encryptedPrivateKey: enc.ciphertext,
    privateIv: enc.iv,
    fingerprint: kp.fingerprint,
    status: "ACTIVE",
    version: 1,
  };
}

export async function seedDatabase(): Promise<{ branches: number; keys: number; seeded: boolean }> {
  // Idempotent: if branches already exist, skip.
  const existing = await db.branch.count();
  if (existing > 0) {
    return { branches: existing, keys: await db.key.count(), seeded: false };
  }

  const codeToId = new Map<string, string>();

  for (const seed of BRANCH_SEEDS) {
    const parentId = seed.parentCode ? codeToId.get(seed.parentCode) ?? null : null;
    const branch = await db.branch.create({
      data: {
        name: seed.name,
        code: seed.code,
        type: seed.type,
        region: seed.region ?? null,
        parentId,
      },
    });
    codeToId.set(seed.code, branch.id);

    // Two key pairs per branch: ECDH (encryption) + ECDSA (signing)
    await db.key.create({ data: makeKeyPairRecord(branch.id, "ENCRYPTION") });
    await db.key.create({ data: makeKeyPairRecord(branch.id, "SIGNING") });
  }

  await recordAudit({
    action: "SEED",
    actor: "SYSTEM",
    status: "SUCCESS",
    details: {
      branchesCreated: BRANCH_SEEDS.length,
      keysCreated: BRANCH_SEEDS.length * 2,
      message: "Initial hierarchy seeded: HQ + 3 regions + 7 departments + 4 sub-branches",
    },
  });

  return {
    branches: BRANCH_SEEDS.length,
    keys: BRANCH_SEEDS.length * 2,
    seeded: true,
  };
}

/** Reset the database (used by the re-seed endpoint). */
export async function resetDatabase(): Promise<void> {
  await db.auditLog.deleteMany();
  await db.document.deleteMany();
  await db.key.deleteMany();
  await db.branch.deleteMany();
}
