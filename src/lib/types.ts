// Shared TypeScript types mirroring the API responses.

export type Role = "OWNER" | "SECURITY_ADMIN" | "BRANCH_ADMIN" | "USER" | "READONLY";

/** Role rank for client-side hierarchy checks (higher = more authority).
 *  Mirrors the server-side ROLE_RANK in src/lib/auth.ts without pulling in
 *  the next/headers dependency (this module is client-safe). */
export const ROLE_RANK: Record<Role, number> = {
  READONLY: 1,
  USER: 2,
  BRANCH_ADMIN: 3,
  SECURITY_ADMIN: 4,
  OWNER: 5,
};

/** Resolve a role string (which may be unknown) into its rank, defaulting to 0. */
export function roleRank(role: string | undefined | null): number {
  if (!role) return 0;
  return ROLE_RANK[role as Role] ?? 0;
}

/** True if the role meets or exceeds the given minimum rank. */
export function hasMinRole(role: string | undefined | null, min: Role): boolean {
  return roleRank(role) >= ROLE_RANK[min];
}

export type UserStatus = "ACTIVE" | "SUSPENDED" | "REVOKED";

export type BranchType = "HEADQUARTERS" | "REGIONAL" | "DEPARTMENT" | "SUB_BRANCH";
export type KeyPurpose = "ENCRYPTION" | "SIGNING";
export type KeyStatus = "ACTIVE" | "ROTATED" | "REVOKED" | "DESTROYED";
export type DocStatus = "DELIVERED" | "DECRYPTED" | "FAILED" | "PURGED";
export type AuditAction =
  | "UPLOAD" | "DOWNLOAD" | "VERIFY" | "KEY_GEN"
  | "KEY_ROTATE" | "KEY_REVOKE" | "KEY_DESTROY" | "BRANCH_CREATE" | "SEED" | "SYSTEM"
  | "LOGIN" | "LOGIN_FAILED" | "LOGOUT"
  | "2FA_ENROLL" | "2FA_VERIFY" | "2FA_FAIL" | "2FA_DISABLE"
  | "DEVICE_REGISTER" | "DEVICE_REVOKE"
  | "LICENSE_ISSUE" | "LICENSE_REVOKE" | "LICENSE_VALIDATE"
  | "USER_CREATE" | "USER_SUSPEND" | "USER_REACTIVATE"
  | "SYSTEM_ACTIVATE" | "SYSTEM_DEACTIVATE" | "LOCKDOWN" | "LOCKDOWN_RELEASE";
export type AuditStatus = "SUCCESS" | "FAILURE" | "WARNING";

export interface Branch {
  id: string;
  code: string;
  name: string;
  type: BranchType;
  region: string | null;
  parentId: string | null;
  parent?: { id: string; code: string; name: string } | null;
  _count?: { keys: number; sentDocs: number; receivedDocs: number; children: number };
  keys?: Array<{
    id: string;
    purpose: KeyPurpose;
    algorithm: string;
    fingerprint: string;
    version: number;
    createdAt: string;
  }>;
}

export interface KeyRecord {
  id: string;
  purpose: KeyPurpose;
  algorithm: string;
  curve: string;
  fingerprint: string;
  status: KeyStatus;
  version: number;
  createdAt: string;
  rotatedAt: string | null;
  revokedAt?: string | null;
  revokedBy?: string | null;
  branch: { id: string; code: string; name: string; type: BranchType };
  publicKeyPem: string;
}

export interface DocumentRecord {
  id: string;
  name: string;
  mimeType: string;
  originalSize: number;
  status: DocStatus;
  packageVersion: string;
  documentHash: string;
  nonce: string;
  sender: { id: string; code: string; name: string };
  recipient: { id: string; code: string; name: string };
  senderKey?: { id: string; purpose: string; version: number; fingerprint: string };
  recipientKey?: { id: string; purpose: string; version: number; fingerprint: string };
  createdAt: string;
  decryptedAt: string | null;
}

export interface AuditLogRecord {
  id: string;
  action: AuditAction;
  actor: string;
  status: AuditStatus;
  details: string;
  ipAddress: string | null;
  branch: { id: string; code: string; name: string } | null;
  document: { id: string; name: string } | null;
  createdAt: string;
}

export interface HierarchyNode {
  id: string;
  code: string;
  name: string;
  type: BranchType;
  region: string | null;
  keyCount: number;
  sentCount: number;
  receivedCount: number;
  children: HierarchyNode[];
}

export interface DashboardData {
  ok: boolean;
  stats: {
    branches: number;
    documents: number;
    keys: number;
    auditEvents: number;
    activeKeys: number;
    rotatedKeys: number;
    revokedKeys: number;
    decryptedDocs: number;
  };
  branchesByType: Record<string, number>;
  hierarchy: HierarchyNode[];
  recentAudit: Array<{
    id: string;
    action: string;
    actor: string;
    status: string;
    details: string;
    createdAt: string;
  }>;
  recentDocs: Array<{
    id: string;
    name: string;
    originalSize: number;
    status: string;
    sender: { code: string; name: string };
    recipient: { code: string; name: string };
    createdAt: string;
  }>;
}

// ---- Devices & Licenses ----

export type DeviceStatus = "ACTIVE" | "REVOKED";
export type LicenseStatus = "ACTIVE" | "REVOKED" | "SUSPENDED" | "EXPIRED";
export type LicenseTier = "STANDARD" | "ENTERPRISE" | "TRIAL";

export interface DeviceRecord {
  id: string;
  userId: string;
  name: string;
  fingerprint: string;
  publicKeyPem: string;
  status: DeviceStatus;
  lastSeenAt: string | null;
  lastSeenIp: string | null;
  createdAt: string;
  revokedAt: string | null;
  revokedBy: string | null;
  user?: {
    id: string;
    username: string;
    displayName: string;
    role: Role;
    branch?: { id: string; code: string; name: string } | null;
  } | null;
  license?: {
    id: string;
    status: LicenseStatus;
    tier: LicenseTier;
    expiresAt: string;
    licenseKey: string;
  } | null;
}

export interface LicenseRecord {
  id: string;
  deviceId: string;
  licenseKey: string;
  status: LicenseStatus;
  tier: LicenseTier;
  issuedAt: string;
  expiresAt: string;
  revokedAt: string | null;
  revokedBy: string | null;
  revokeReason: string | null;
  signature?: string;
  signerFingerprint: string;
  device?: {
    id: string;
    name: string;
    fingerprint: string;
    status: DeviceStatus;
    owner?: {
      id: string;
      username: string;
      displayName: string;
      role: Role;
    } | null;
  } | null;
}

// ---- System state ----

export interface SystemState {
  active: boolean;
  lockdown: boolean;
  lockdownReason: string | null;
  lockedBy: string | null;
  lockedAt: string | null;
}

export interface SystemCounts {
  users: number;
  activeUsers: number;
  suspendedUsers: number;
  devices: number;
  activeDevices: number;
  revokedDevices: number;
  licenses: number;
  activeLicenses: number;
  revokedLicenses: number;
}

export interface SystemLicensing {
  publicKey: string;
  fingerprint: string;
}

export interface SystemStateResponse {
  ok: boolean;
  state: SystemState;
  counts: SystemCounts;
  licensing: SystemLicensing;
}

// ---- Session user (mirrors /api/auth/me) ----

export interface SessionUser {
  id: string;
  username: string;
  displayName: string;
  role: Role;
  status: UserStatus;
  branchId: string | null;
  branch: { id: string; code: string; name: string; type: string } | null;
  twoFactorEnabled: boolean;
  twoFactorEnforced: boolean;
}

// ---- Monitoring dashboard ----

export interface MonitoringData {
  ok: boolean;
  timestamp: string;
  entities: {
    users: number;
    activeUsers: number;
    suspendedUsers: number;
    branches: number;
    documents: number;
    keys: number;
    activeKeys: number;
    sessions: number;
    activeSessions: number;
    devices: number;
    licenses: number;
    auditEvents: number;
  };
  timeSeries: {
    documentsPerHour: Array<{ hour: string; count: number }>;
    auditPerHour: Array<{ hour: string; count: number }>;
    authAttempts: Array<{ hour: string; success: number; failure: number }>;
  };
  breakdowns: {
    documentsByStatus: Array<{ status: string; count: number }>;
    documentsByBranch: Array<{ code: string; name: string; count: number }>;
    auditByAction: Array<{ action: string; count: number }>;
    authByMethod: Array<{ method: string; status: string; count: number }>;
    usersByRole: Array<{ role: string; count: number }>;
    keysByStatus: Array<{ status: string; count: number }>;
  };
  securityEvents: Array<{
    id: string;
    action: string;
    actor: string;
    status: string;
    ipAddress: string | null;
    createdAt: string;
    details: string | null;
  }>;
  health: {
    uptime: number;
    memoryMB: { rss: number; heapUsed: number; heapTotal: number };
    redis: boolean;
    dbQueryAvgMs: number;
    httpRequests: number;
    httpErrors: number;
    encryptOps: number;
    cache: Record<string, { hits: number; misses: number; sets: number; deletes: number; evictions: number; size: number; hitRate: number }>;
  };
}
