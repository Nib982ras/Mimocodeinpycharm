"use client";

import { useEffect, useState, useCallback } from "react";
import {
  ScrollText,
  Upload,
  Download,
  ShieldCheck,
  KeyRound,
  RefreshCw,
  Ban,
  Network,
  Database,
  Server,
  Filter,
} from "lucide-react";
import { api } from "@/lib/api";
import type { AuditLogRecord, AuditAction, AuditStatus } from "@/lib/types";
import { AUDIT_ACTION_META, formatDateTime, formatRelativeTime } from "@/lib/format";
import { Panel, PanelHeader, Badge, EmptyState } from "./shared";
import { cn } from "@/lib/utils";

const STATUS_DOT: Record<AuditStatus, string> = {
  SUCCESS: "bg-emerald-400",
  WARNING: "bg-amber-400",
  FAILURE: "bg-rose-400",
};

const STATUS_BADGE: Record<AuditStatus, string> = {
  SUCCESS: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300",
  WARNING: "border-amber-500/40 bg-amber-500/10 text-amber-300",
  FAILURE: "border-rose-500/40 bg-rose-500/10 text-rose-300",
};

const ACTION_ICONS: Record<string, typeof Upload> = {
  UPLOAD: Upload,
  DOWNLOAD: Download,
  VERIFY: ShieldCheck,
  KEY_GEN: KeyRound,
  KEY_ROTATE: RefreshCw,
  KEY_REVOKE: Ban,
  BRANCH_CREATE: Network,
  SEED: Database,
  SYSTEM: Server,
};

export function AuditSection() {
  const [logs, setLogs] = useState<AuditLogRecord[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string>("");

  const load = useCallback(async () => {
    try {
      const res = await api.audit(filter ? { action: filter } : undefined);
      setLogs(res.logs);
      setCounts(res.counts);
    } catch {
      // 401 → auth:unauthorized event flips to login; other errors keep state.
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => { load(); }, [load]);

  const total = Object.values(counts).reduce((a, b) => a + b, 0);

  return (
    <div className="space-y-5">
      <Panel>
        <PanelHeader
          title="Audit Trail"
          subtitle={`${total} immutable event${total === 1 ? "" : "s"} recorded`}
          icon={<ScrollText className="h-4 w-4" />}
        />
        {/* Filter chips */}
        <div className="flex flex-wrap items-center gap-1.5 px-4 md:px-5 py-3 border-b border-slate-800">
          <div className="flex items-center gap-1.5 text-[11px] text-slate-500 mr-2">
            <Filter className="h-3 w-3" /> Filter:
          </div>
          <button
            onClick={() => setFilter("")}
            className={cn(
              "rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors",
              filter === "" ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-300" : "border-slate-700 bg-slate-800/40 text-slate-400 hover:text-slate-200"
            )}
          >
            All ({total})
          </button>
          {Object.entries(AUDIT_ACTION_META).map(([action, meta]) => {
            const count = counts[action] ?? 0;
            if (count === 0 && action !== "UPLOAD" && action !== "DOWNLOAD" && action !== "SEED" && action !== "KEY_ROTATE" && action !== "BRANCH_CREATE") return null;
            const Icon = ACTION_ICONS[action] ?? ScrollText;
            return (
              <button
                key={action}
                onClick={() => setFilter(filter === action ? "" : action)}
                className={cn(
                  "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors",
                  filter === action ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-300" : "border-slate-700 bg-slate-800/40 text-slate-400 hover:text-slate-200"
                )}
              >
                <Icon className="h-3 w-3" /> {meta.label} ({count})
              </button>
            );
          })}
        </div>

        <div className="p-2">
          {loading ? (
            <div className="space-y-2 p-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="h-14 rounded-lg bg-slate-800/40 animate-pulse" />
              ))}
            </div>
          ) : logs.length === 0 ? (
            <EmptyState icon={<ScrollText className="h-10 w-10" />} title="No audit events" description={filter ? `No events for action "${filter}".` : "Audit events will appear here."} />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-[11px] text-slate-500 uppercase tracking-wide border-b border-slate-800">
                    <th className="text-left font-medium px-3 py-2">Time</th>
                    <th className="text-left font-medium px-3 py-2">Action</th>
                    <th className="text-left font-medium px-3 py-2">Actor</th>
                    <th className="text-left font-medium px-3 py-2 hidden md:table-cell">Details</th>
                    <th className="text-left font-medium px-3 py-2">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/70">
                  {logs.map((l) => {
                    const Icon = ACTION_ICONS[l.action] ?? ScrollText;
                    let details: Record<string, unknown> = {};
                    try { details = JSON.parse(l.details); } catch { /* ignore */ }
                    return (
                      <tr key={l.id} className="hover:bg-slate-800/30 align-top">
                        <td className="px-3 py-2.5 whitespace-nowrap">
                          <div className="text-xs text-slate-300">{formatRelativeTime(l.createdAt)}</div>
                          <div className="text-[10px] text-slate-600">{formatDateTime(l.createdAt)}</div>
                        </td>
                        <td className="px-3 py-2.5">
                          <div className="flex items-center gap-1.5">
                            <Icon className="h-3.5 w-3.5 text-emerald-400" />
                            <span className="text-xs font-medium text-slate-200">{l.action}</span>
                          </div>
                        </td>
                        <td className="px-3 py-2.5">
                          <span className="font-mono text-xs text-emerald-400">{l.actor}</span>
                          {l.branch && <div className="text-[10px] text-slate-500 truncate max-w-[120px]">{l.branch.name}</div>}
                        </td>
                        <td className="px-3 py-2.5 hidden md:table-cell max-w-md">
                          <div className="text-[11px] text-slate-400 font-mono space-y-0.5">
                            {Object.entries(details).slice(0, 4).map(([k, v]) => (
                              <div key={k} className="truncate">
                                <span className="text-slate-500">{k}:</span>{" "}
                                <span className="text-slate-300">{String(v).slice(0, 60)}</span>
                              </div>
                            ))}
                            {l.document && (
                              <div className="truncate"><span className="text-slate-500">doc:</span> <span className="text-slate-300">{l.document.name}</span></div>
                            )}
                          </div>
                        </td>
                        <td className="px-3 py-2.5">
                          <Badge className={cn("border", STATUS_BADGE[l.status as AuditStatus] ?? STATUS_BADGE.SUCCESS)}>
                            <span className={cn("h-1.5 w-1.5 rounded-full", STATUS_DOT[l.status as AuditStatus] ?? STATUS_DOT.SUCCESS)} />
                            {l.status}
                          </Badge>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </Panel>
    </div>
  );
}
