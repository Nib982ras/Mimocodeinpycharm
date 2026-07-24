import { db } from "@/lib/db";
import {
  generateEcKeyPair,
  encryptPrivateKey,
  type KeyPairPem,
} from "@/lib/crypto";
import { recordAudit } from "@/lib/audit";
import { hashPassword } from "@/lib/auth";

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

  // Provision user accounts:
  //   - one OWNER (supreme authority — system activation, lockdown, key destruction)
  //   - one SECURITY_ADMIN (user/branch/key management)
  //   - one BRANCH_ADMIN per region (manages their region's departments)
  //   - one USER per department
  //   - one READONLY user on a sub-branch
  const departments = await db.branch.findMany({ where: { type: "DEPARTMENT" } });
  const regions = await db.branch.findMany({ where: { type: "REGIONAL" } });
  const subBranches = await db.branch.findMany({ where: { type: "SUB_BRANCH" } });
  const usersCreated: { username: string; role: string; branch: string }[] = [];

  // 1. System owner — sole supreme authority. No branch.
  await db.user.create({
    data: {
      username: "owner",
      displayName: "System Owner",
      passwordHash: hashPassword("owner123"),
      role: "OWNER",
      branchId: null,
    },
  });
  usersCreated.push({ username: "owner", role: "OWNER", branch: "—" });

  // 2. Security administrator
  await db.user.create({
    data: {
      username: "secadmin",
      displayName: "Security Administrator",
      passwordHash: hashPassword("secadmin123"),
      role: "SECURITY_ADMIN",
      branchId: null,
    },
  });
  usersCreated.push({ username: "secadmin", role: "SECURITY_ADMIN", branch: "—" });

  // 3. One branch admin per regional hub
  for (const reg of regions) {
    const username = `${reg.code.toLowerCase()}-admin`;
    await db.user.create({
      data: {
        username,
        displayName: `${reg.name} Administrator`,
        passwordHash: hashPassword(username),
        role: "BRANCH_ADMIN",
        branchId: reg.id,
      },
    });
    usersCreated.push({ username, role: "BRANCH_ADMIN", branch: reg.code });
  }

  // 4. One USER per department — username/password = lowercased code
  for (const dept of departments) {
    const username = dept.code.toLowerCase();
    await db.user.create({
      data: {
        username,
        displayName: dept.name,
        passwordHash: hashPassword(username),
        role: "USER",
        branchId: dept.id,
      },
    });
    usersCreated.push({ username, role: "USER", branch: dept.code });
  }

  // 5. One READONLY user on the first sub-branch
  if (subBranches.length > 0) {
    const sub = subBranches[0];
    const username = `${sub.code.toLowerCase()}-viewer`;
    await db.user.create({
      data: {
        username,
        displayName: `${sub.name} (Read-Only)`,
        passwordHash: hashPassword(username),
        role: "READONLY",
        branchId: sub.id,
      },
    });
    usersCreated.push({ username, role: "READONLY", branch: sub.code });
  }

  // Initialize the singleton SystemState (active, not locked down).
  await db.systemState.upsert({
    where: { id: "singleton" },
    update: {},
    create: { id: "singleton", active: true, lockdown: false },
  });

  await recordAudit({
    action: "SEED",
    actor: "SYSTEM",
    status: "SUCCESS",
    details: {
      usersCreated: usersCreated.length,
      message: "Seeded owner + security admin + branch admins + department users + readonly viewer",
      roles: usersCreated.reduce((acc, u) => {
        acc[u.role] = (acc[u.role] ?? 0) + 1;
        return acc;
      }, {} as Record<string, number>),
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
  await db.session.deleteMany();
  await db.auditLog.deleteMany();
  await db.document.deleteMany();
  await db.license.deleteMany();
  await db.device.deleteMany();
  await db.twoFactor.deleteMany();
  await db.key.deleteMany();
  await db.user.deleteMany();
  await db.systemState.deleteMany();
  await db.branch.deleteMany();
}
