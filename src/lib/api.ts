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
};
