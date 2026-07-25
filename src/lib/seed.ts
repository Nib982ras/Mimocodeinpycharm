import crypto from "crypto";
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
 * topology from 02_NETWORK_TOPOLOGY.md.
 *
 * SECURITY: All passwords are randomly generated and returned in the seed
 * result. They are NEVER stored in plaintext. The caller must save them
 * securely (e.g., in a password manager or secure vault).
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

/**
 * Generate a cryptographically strong random password.
 * Length: 20 characters, mixed case + digits + symbols.
 */
function generateSecurePassword(): string {
  const upper = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const lower = "abcdefghijklmnopqrstuvwxyz";
  const digits = "0123456789";
  const symbols = "!@#$%^&*";
  const all = upper + lower + digits + symbols;

  // Ensure at least one of each category
  let pw = "";
  pw += upper[crypto.randomInt(upper.length)];
  pw += lower[crypto.randomInt(lower.length)];
  pw += digits[crypto.randomInt(digits.length)];
  pw += symbols[crypto.randomInt(symbols.length)];

  // Fill remaining with random from all categories
  for (let i = 4; i < 20; i++) {
    pw += all[crypto.randomInt(all.length)];
  }

  // Shuffle the password
  const arr = pw.split("");
  for (let i = arr.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr.join("");
}

export interface SeedResult {
  branches: number;
  keys: number;
  seeded: boolean;
  credentials?: Array<{
    username: string;
    password: string;
    role: string;
    branch: string;
  }>;
}

export async function seedDatabase(): Promise<SeedResult> {
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

  // Provision user accounts with RANDOM passwords
  const departments = await db.branch.findMany({ where: { type: "DEPARTMENT" } });
  const regions = await db.branch.findMany({ where: { type: "REGIONAL" } });
  const subBranches = await db.branch.findMany({ where: { type: "SUB_BRANCH" } });
  const credentials: SeedResult["credentials"] = [];

  // 1. System owner
  const ownerPw = generateSecurePassword();
  await db.user.create({
    data: {
      username: "owner",
      displayName: "System Owner",
      passwordHash: hashPassword(ownerPw),
      role: "OWNER",
      branchId: null,
    },
  });
  credentials.push({ username: "owner", password: ownerPw, role: "OWNER", branch: "—" });

  // 2. Security administrator
  const secPw = generateSecurePassword();
  await db.user.create({
    data: {
      username: "secadmin",
      displayName: "Security Administrator",
      passwordHash: hashPassword(secPw),
      role: "SECURITY_ADMIN",
      branchId: null,
    },
  });
  credentials.push({ username: "secadmin", password: secPw, role: "SECURITY_ADMIN", branch: "—" });

  // 3. Branch admins
  for (const reg of regions) {
    const username = `${reg.code.toLowerCase()}-admin`;
    const pw = generateSecurePassword();
    await db.user.create({
      data: {
        username,
        displayName: `${reg.name} Administrator`,
        passwordHash: hashPassword(pw),
        role: "BRANCH_ADMIN",
        branchId: reg.id,
      },
    });
    credentials.push({ username, password: pw, role: "BRANCH_ADMIN", branch: reg.code });
  }

  // 4. Department users
  for (const dept of departments) {
    const username = dept.code.toLowerCase();
    const pw = generateSecurePassword();
    await db.user.create({
      data: {
        username,
        displayName: dept.name,
        passwordHash: hashPassword(pw),
        role: "USER",
        branchId: dept.id,
      },
    });
    credentials.push({ username, password: pw, role: "USER", branch: dept.code });
  }

  // 5. Read-only user
  if (subBranches.length > 0) {
    const sub = subBranches[0];
    const username = `${sub.code.toLowerCase()}-viewer`;
    const pw = generateSecurePassword();
    await db.user.create({
      data: {
        username,
        displayName: `${sub.name} (Read-Only)`,
        passwordHash: hashPassword(pw),
        role: "READONLY",
        branchId: sub.id,
      },
    });
    credentials.push({ username, password: pw, role: "READONLY", branch: sub.code });
  }

  // Initialize the singleton SystemState
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
      usersCreated: credentials.length,
      message: "Seeded owner + security admin + branch admins + department users + readonly viewer",
      roles: credentials.reduce((acc, u) => {
        acc[u.role] = (acc[u.role] ?? 0) + 1;
        return acc;
      }, {} as Record<string, number>),
    },
  });

  return {
    branches: BRANCH_SEEDS.length,
    keys: BRANCH_SEEDS.length * 2,
    seeded: true,
    credentials,
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
