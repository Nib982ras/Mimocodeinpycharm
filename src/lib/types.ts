// Shared TypeScript types mirroring the API responses.

export type BranchType = "HEADQUARTERS" | "REGIONAL" | "DEPARTMENT" | "SUB_BRANCH";
export type KeyPurpose = "ENCRYPTION" | "SIGNING";
export type KeyStatus = "ACTIVE" | "ROTATED" | "REVOKED";
export type DocStatus = "DELIVERED" | "DECRYPTED" | "FAILED";
export type AuditAction =
  | "UPLOAD" | "DOWNLOAD" | "VERIFY" | "KEY_GEN"
  | "KEY_ROTATE" | "KEY_REVOKE" | "BRANCH_CREATE" | "SEED" | "SYSTEM";
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
