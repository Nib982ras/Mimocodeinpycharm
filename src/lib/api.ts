// Thin fetch wrappers around the JSON API.
//
// All requests include `credentials: "include"` so the session cookie is sent
// even when the app runs behind a reverse proxy / preview iframe.
//
// On a 401 (session expired / invalid), we dispatch a global
// `auth:unauthorized` event so the AuthProvider can proactively re-check the
// session and flip back to the login screen — instead of letting the error
// bubble up and crash the React tree.

async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { credentials: "include", ...init });
  const ct = res.headers.get("content-type") || "";
  if (!res.ok) {
    // Signal an expired/invalid session so the app returns to login gracefully.
    if (res.status === 401 && typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("auth:unauthorized"));
    }
    if (ct.includes("application/json")) {
      const body = await res.json().catch(() => ({}));
      throw new ApiError(body.error || `Request failed (${res.status})`, res.status);
    }
    throw new ApiError(`Request failed (${res.status})`, res.status);
  }
  if (ct.includes("application/json")) return res.json() as Promise<T>;
  return (await res.text()) as unknown as T;
}

/** Error carrying the HTTP status, so callers can distinguish 401/403/404 etc. */
export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

/** True if an error is an authentication failure (401). */
export function isUnauthorized(err: unknown): boolean {
  return err instanceof ApiError && err.status === 401;
}

export const api = {
  seed: () => json<{ ok: boolean; branches: number; keys: number; seeded: boolean }>("/api/seed", { method: "POST" }),
  dashboard: () => json<import("@/lib/types").DashboardData>("/api/dashboard"),
  branches: () => json<{ ok: boolean; branches: import("@/lib/types").Branch[] }>("/api/branches"),
  createBranch: (data: { name: string; code: string; type: string; region?: string; parentId?: string }) =>
    json<{ ok: boolean; branch: import("@/lib/types").Branch }>("/api/branches", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    }),
  keys: () => json<{ ok: boolean; keys: import("@/lib/types").KeyRecord[] }>("/api/keys"),
  rotateKey: (id: string) =>
    json<{ ok: boolean; newKey: { id: string; version: number; fingerprint: string } }>(`/api/keys/${id}/rotate`, { method: "POST" }),
  documents: (params?: { branchId?: string; direction?: "sent" | "received" }) => {
    const qs = new URLSearchParams();
    if (params?.branchId) qs.set("branchId", params.branchId);
    if (params?.direction) qs.set("direction", params.direction);
    const s = qs.toString();
    return json<{ ok: boolean; documents: import("@/lib/types").DocumentRecord[] }>(`/api/documents${s ? `?${s}` : ""}`);
  },
  document: (id: string) =>
    json<{ ok: boolean; document: import("@/lib/types").DocumentRecord }>(`/api/documents/${id}`),
  uploadDocument: (file: File, senderBranchId: string, recipientBranchId: string) => {
    const fd = new FormData();
    fd.append("file", file);
    fd.append("senderBranchId", senderBranchId);
    fd.append("recipientBranchId", recipientBranchId);
    return json<{ ok: boolean; document: import("@/lib/types").DocumentRecord }>("/api/documents", { method: "POST", body: fd });
  },
  decryptDocument: async (id: string) => {
    const res = await fetch(`/api/documents/${id}/decrypt`, { method: "POST", credentials: "include" });
    if (!res.ok) {
      if (res.status === 401 && typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("auth:unauthorized"));
      }
      const body = await res.json().catch(() => ({}));
      throw new ApiError(body.error || `Decrypt failed (${res.status})`, res.status);
    }
    return {
      blob: await res.blob(),
      signatureValid: res.headers.get("x-signature-valid") === "true",
      documentHashValid: res.headers.get("x-document-hash-valid") === "true",
      documentHash: res.headers.get("x-document-hash") || "",
      workflow: res.headers.get("x-workflow") || "",
    };
  },
  audit: (params?: { action?: string; status?: string }) => {
    const qs = new URLSearchParams();
    if (params?.action) qs.set("action", params.action);
    if (params?.status) qs.set("status", params.status);
    const s = qs.toString();
    return json<{ ok: boolean; counts: Record<string, number>; logs: import("@/lib/types").AuditLogRecord[] }>(`/api/audit${s ? `?${s}` : ""}`);
  },
  // ---- System control (owner) ----
  systemState: () => json<import("@/lib/types").SystemStateResponse>("/api/system/state"),
  activateSystem: () => json<{ ok: boolean; active: boolean }>("/api/system/activate", { method: "POST" }),
  deactivateSystem: (reason: string) => json<{ ok: boolean; active: boolean; reason: string }>("/api/system/deactivate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reason }) }),
  lockdown: (reason: string) => json<{ ok: boolean; lockdown: boolean; reason: string; sessionsRevoked: number }>("/api/system/lockdown", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reason }) }),
  releaseLockdown: () => json<{ ok: boolean; lockdown: boolean }>("/api/system/release", { method: "POST" }),
  // ---- 2FA ----
  setup2fa: () => json<{ ok: boolean; secret: string; otpauthUri: string; backupCodes: string[] }>("/api/2fa/setup", { method: "POST" }),
  verify2fa: (code: string) => json<{ ok: boolean }>("/api/2fa/verify", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code }) }),
  disable2fa: (userId?: string) => json<{ ok: boolean }>("/api/2fa/disable", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userId }) }),
  // ---- User management (extended) ----
  suspendUser: (id: string, suspend: boolean, reason?: string) => json<{ ok: boolean; status: string }>(`/api/users/${id}/suspend`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ suspend, reason }) }),
  usersRaw: () =>
    json<{
      ok: boolean;
      actor: string;
      users: Array<{
        id: string;
        username: string;
        displayName: string;
        role: import("@/lib/types").Role;
        status: import("@/lib/types").UserStatus;
        branchId: string | null;
        branch: { id: string; code: string; name: string; type: string } | null;
        twoFactorEnabled: boolean;
        twoFactorEnforced: boolean;
        createdAt: string;
      }>;
    }>("/api/users"),
  createUserRaw: (data: { username: string; displayName?: string; password: string; role: string; branchId?: string | null }) =>
    json<{ ok: boolean; error?: string; user: import("@/lib/types").SessionUser }>("/api/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    }),
  deleteUserRaw: (id: string) =>
    json<{ ok: boolean; error?: string }>(`/api/users/${id}`, { method: "DELETE" }),
  resetPasswordRaw: (id: string, password: string) =>
    json<{ ok: boolean; error?: string }>(`/api/users/${id}/password`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    }),
  // ---- Devices ----
  devices: () => json<{ ok: boolean; devices: import("@/lib/types").DeviceRecord[] }>("/api/devices"),
  registerDevice: (name: string, publicKeyPem: string) => json<{ ok: boolean; device: import("@/lib/types").DeviceRecord }>("/api/devices", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, publicKeyPem }) }),
  revokeDevice: (id: string) => json<{ ok: boolean }>(`/api/devices/${id}/revoke`, { method: "POST" }),
  // ---- Licenses ----
  licenses: () => json<{ ok: boolean; licenses: import("@/lib/types").LicenseRecord[] }>("/api/licenses"),
  issueLicense: (deviceId: string, tier: string, expiresInDays: number) => json<{ ok: boolean; license: import("@/lib/types").LicenseRecord }>("/api/licenses", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ deviceId, tier, expiresInDays }) }),
  revokeLicense: (id: string, reason?: string) => json<{ ok: boolean }>(`/api/licenses/${id}/revoke`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reason }) }),
  validateLicense: (licenseKey: string, deviceFingerprint: string) => json<{ ok: boolean; valid: boolean; reason?: string }>("/api/licenses/validate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ licenseKey, deviceFingerprint }) }),
  // ---- Key destruction (owner) ----
  revokeKey: (id: string, purgeDocuments?: boolean) => json<{ ok: boolean; status: string; purgedDocuments: number }>(`/api/keys/${id}/revoke`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ purgeDocuments }) }),
};

