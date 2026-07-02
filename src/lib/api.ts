// Thin fetch wrappers around the JSON API.

async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const ct = res.headers.get("content-type") || "";
  if (!res.ok) {
    if (ct.includes("application/json")) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || `Request failed (${res.status})`);
    }
    throw new Error(`Request failed (${res.status})`);
  }
  if (ct.includes("application/json")) return res.json() as Promise<T>;
  return (await res.text()) as unknown as T;
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
    const res = await fetch(`/api/documents/${id}/decrypt`, { method: "POST" });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || `Decrypt failed (${res.status})`);
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
