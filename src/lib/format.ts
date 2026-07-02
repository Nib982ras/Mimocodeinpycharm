// Formatting + display helpers shared across sections.

export function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

export function formatRelativeTime(iso: string): string {
  const d = new Date(iso).getTime();
  const now = Date.now();
  const diff = Math.max(0, now - d);
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day}d ago`;
  return new Date(iso).toLocaleDateString();
}

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function shortHash(hash: string, head = 12, tail = 8): string {
  if (!hash) return "—";
  if (hash.length <= head + tail) return hash;
  return `${hash.slice(0, head)}…${hash.slice(-tail)}`;
}

export const BRANCH_TYPE_META: Record<
  string,
  { label: string; color: string; dot: string }
> = {
  HEADQUARTERS: { label: "Headquarters", color: "text-emerald-300 border-emerald-500/40 bg-emerald-500/10", dot: "bg-emerald-400" },
  REGIONAL: { label: "Regional Hub", color: "text-teal-300 border-teal-500/40 bg-teal-500/10", dot: "bg-teal-400" },
  DEPARTMENT: { label: "Department", color: "text-cyan-300 border-cyan-500/40 bg-cyan-500/10", dot: "bg-cyan-400" },
  SUB_BRANCH: { label: "Sub-branch", color: "text-sky-300 border-sky-500/40 bg-sky-500/10", dot: "bg-sky-400" },
};

export const AUDIT_ACTION_META: Record<string, { label: string; icon: string }> = {
  UPLOAD: { label: "Upload", icon: "upload" },
  DOWNLOAD: { label: "Download", icon: "download" },
  VERIFY: { label: "Verify", icon: "shield-check" },
  KEY_GEN: { label: "Key Gen", icon: "key-round" },
  KEY_ROTATE: { label: "Key Rotate", icon: "refresh-cw" },
  KEY_REVOKE: { label: "Key Revoke", icon: "ban" },
  BRANCH_CREATE: { label: "Branch Create", icon: "network" },
  SEED: { label: "System Seed", icon: "database" },
  SYSTEM: { label: "System", icon: "server" },
};
