"use client";

import { useEffect, useState, useCallback } from "react";
import {
  Network,
  FileLock2,
  KeyRound,
  ScrollText,
  ShieldCheck,
  Activity,
  Building2,
  Boxes,
  ChevronRight,
  ArrowRight,
  Lock,
  Unlock,
  Cpu,
  Power,
  PowerOff,
  AlertOctagon,
  BadgeCheck,
  Smartphone,
  ShieldAlert,
} from "lucide-react";
import { api } from "@/lib/api";
import type { DashboardData, HierarchyNode, BranchType, SystemStateResponse } from "@/lib/types";
import { BRANCH_TYPE_META, formatRelativeTime, formatBytes } from "@/lib/format";
import { Panel, PanelHeader, StatCard, Badge, EmptyState } from "./shared";
import { Button } from "@/components/ui/button";
import { Enable2faDialog, Disable2faDialog } from "./twofa";
import { useAuth } from "@/components/auth-provider";
import { cn } from "@/lib/utils";

interface Props {
  onNavigate: (id: "dashboard" | "documents" | "branches" | "keys" | "audit" | "users" | "devices" | "licenses" | "system") => void;
}

export function DashboardSection({ onNavigate }: Props) {
  const { user } = useAuth();
  const [data, setData] = useState<DashboardData | null>(null);
  const [sys, setSys] = useState<SystemStateResponse | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const [d, s] = await Promise.all([
        api.dashboard().catch(() => null),
        api.systemState().catch(() => null),
      ]);
      if (d) setData(d);
      if (s) setSys(s);
    } catch {
      /* 401 handled centrally */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let isMounted = true;
    const loadData = async () => {
      try {
        const [d, s] = await Promise.all([
          api.dashboard().catch(() => null),
          api.systemState().catch(() => null),
        ]);
        if (isMounted) {
          if (d) setData(d);
          if (s) setSys(s);
        }
      } catch {
        /* 401 handled centrally */
      } finally {
        if (isMounted) setLoading(false);
      }
    };
    loadData();
    return () => { isMounted = false; };
  }, []);

  if (loading || !data) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-28 rounded-xl bg-slate-900/60 border border-slate-800 animate-pulse" />
        ))}
      </div>
    );
  }

  const { stats } = data;
  const sysState = sys?.state;
  const sysCounts = sys?.counts;

  return (
    <div className="space-y-5">
      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
        <StatCard label="Branches" value={stats.branches} sub={`${data.branchesByType.REGIONAL ?? 0} regional hubs`} icon={<Building2 className="h-5 w-5" />} accent="emerald" />
        <StatCard label="Documents" value={stats.documents} sub={`${stats.decryptedDocs} decrypted`} icon={<FileLock2 className="h-5 w-5" />} accent="teal" />
        <StatCard label="Active Keys" value={stats.activeKeys} sub={`${stats.rotatedKeys} rotated`} icon={<KeyRound className="h-5 w-5" />} accent="cyan" />
        <StatCard label="Audit Events" value={stats.auditEvents} sub="immutable log" icon={<ScrollText className="h-5 w-5" />} accent="amber" />
      </div>

      {/* System status + Security settings row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <SystemStatusCard
          sys={sys}
          onNavigate={onNavigate}
          canManage={user?.role === "OWNER"}
        />
        <SecuritySettingsCard />
      </div>

      {/* Quick stats — devices / licenses */}
      {sysCounts && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
          <StatCard label="Active Devices" value={sysCounts.activeDevices} sub={`${sysCounts.revokedDevices} revoked`} icon={<Cpu className="h-5 w-5" />} accent="emerald" />
          <StatCard label="Active Licenses" value={sysCounts.activeLicenses} sub={`${sysCounts.revokedLicenses} revoked`} icon={<BadgeCheck className="h-5 w-5" />} accent="teal" />
          <StatCard label="Active Users" value={sysCounts.activeUsers} sub={`${sysCounts.suspendedUsers} suspended`} icon={<Activity className="h-5 w-5" />} accent="cyan" />
          <StatCard label="Total Users" value={sysCounts.users} sub="all roles" icon={<Building2 className="h-5 w-5" />} accent="amber" />
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Hierarchy tree */}
        <Panel className="lg:col-span-2">
          <PanelHeader
            title="Network Topology"
            subtitle="Hierarchical trust chain — HQ → Regional → Department → Sub-branch"
            icon={<Network className="h-4 w-4" />}
            action={
              <button onClick={() => onNavigate("branches")} className="inline-flex items-center gap-1 text-xs text-emerald-400 hover:text-emerald-300">
                Manage <ChevronRight className="h-3 w-3" />
              </button>
            }
          />
          <div className="p-3 md:p-4 overflow-x-auto">
            <div className="space-y-1 min-w-fit">
              {data.hierarchy.map((node) => (
                <HierarchyRow key={node.id} node={node} depth={0} />
              ))}
            </div>
          </div>
        </Panel>

        {/* Crypto stack */}
        <Panel>
          <PanelHeader title="Cryptographic Stack" subtitle="Defense in depth" icon={<Cpu className="h-4 w-4" />} />
          <div className="p-4 space-y-2.5">
            {[
              { layer: "Application", value: "Hybrid Encryption", color: "text-emerald-300" },
              { layer: "Symmetric", value: "AES-256-GCM", color: "text-teal-300" },
              { layer: "Key Exchange", value: "ECDH (P-521)", color: "text-cyan-300" },
              { layer: "Signature", value: "ECDSA-SHA512", color: "text-emerald-300" },
              { layer: "KDF", value: "HKDF-SHA256", color: "text-emerald-300" },
              { layer: "Transport", value: "TLS 1.3 (ECDHE)", color: "text-teal-300" },
            ].map((row, i) => (
              <div key={row.layer} className="flex items-center gap-3">
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-slate-800 border border-slate-700 text-[10px] font-mono text-slate-400">
                  {i + 1}
                </div>
                <div className="flex-1 flex items-center justify-between min-w-0">
                  <span className="text-xs text-slate-400">{row.layer}</span>
                  <span className={cn("text-xs font-mono font-medium", row.color)}>{row.value}</span>
                </div>
              </div>
            ))}
            <div className="pt-2 mt-2 border-t border-slate-800 flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-emerald-400" />
              <span className="text-[11px] text-slate-400">Perfect forward secrecy on every session</span>
            </div>
          </div>
        </Panel>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Recent documents */}
        <Panel>
          <PanelHeader
            title="Recent Document Exchanges"
            subtitle="Encrypted packages in transit"
            icon={<FileLock2 className="h-4 w-4" />}
            action={
              <button onClick={() => onNavigate("documents")} className="inline-flex items-center gap-1 text-xs text-emerald-400 hover:text-emerald-300">
                View all <ArrowRight className="h-3 w-3" />
              </button>
            }
          />
          <div className="p-2">
            {data.recentDocs.length === 0 ? (
              <EmptyState icon={<FileLock2 className="h-8 w-8" />} title="No documents yet" description="Upload and encrypt a document to begin a secure exchange." />
            ) : (
              <div className="divide-y divide-slate-800/70">
                {data.recentDocs.map((d) => (
                  <div key={d.id} className="flex items-center gap-3 px-2 py-2.5">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-800 border border-slate-700">
                      {d.status === "DECRYPTED" ? <Unlock className="h-4 w-4 text-emerald-400" /> : <Lock className="h-4 w-4 text-amber-400" />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm text-slate-200 truncate font-medium">{d.name}</div>
                      <div className="text-[11px] text-slate-500 font-mono">
                        {d.sender.code} → {d.recipient.code} · {formatBytes(d.originalSize)}
                      </div>
                    </div>
                    <Badge className={d.status === "DECRYPTED" ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300" : "border-amber-500/40 bg-amber-500/10 text-amber-300"}>
                      {d.status}
                    </Badge>
                  </div>
                ))}
              </div>
            )}
          </div>
        </Panel>

        {/* Recent audit activity */}
        <Panel>
          <PanelHeader
            title="Recent Activity"
            subtitle="Live cryptographic operations"
            icon={<Activity className="h-4 w-4" />}
            action={
              <button onClick={() => onNavigate("audit")} className="inline-flex items-center gap-1 text-xs text-emerald-400 hover:text-emerald-300">
                Full log <ArrowRight className="h-3 w-3" />
              </button>
            }
          />
          <div className="p-2">
            {data.recentAudit.length === 0 ? (
              <EmptyState icon={<Activity className="h-8 w-8" />} title="No activity recorded" />
            ) : (
              <div className="space-y-1 max-h-80 overflow-y-auto pr-1">
                {data.recentAudit.map((a) => (
                  <div key={a.id} className="flex items-start gap-3 px-2 py-2 rounded-md hover:bg-slate-800/40">
                    <div className={cn("mt-1.5 h-2 w-2 rounded-full shrink-0", a.status === "SUCCESS" ? "bg-emerald-400" : a.status === "WARNING" ? "bg-amber-400" : "bg-rose-400")} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-medium text-slate-200">{a.action}</span>
                        <span className="text-[11px] text-slate-500 font-mono">{a.actor}</span>
                      </div>
                      <div className="text-[11px] text-slate-500">{formatRelativeTime(a.createdAt)}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </Panel>
      </div>

      {/* Security highlights */}
      <Panel>
        <PanelHeader title="Security Properties" subtitle="Threat mitigation across the exchange workflow" icon={<ShieldCheck className="h-4 w-4" />} />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-px bg-slate-800">
          {[
            { label: "Confidentiality", value: "AES-256-GCM", icon: <Lock className="h-4 w-4" /> },
            { label: "Integrity", value: "SHA-512 + GCM tag", icon: <ShieldCheck className="h-4 w-4" /> },
            { label: "Authenticity", value: "ECDSA signatures", icon: <KeyRound className="h-4 w-4" /> },
            { label: "Forward Secrecy", value: "Ephemeral ECDH", icon: <Boxes className="h-4 w-4" /> },
          ].map((p) => (
            <div key={p.label} className="bg-slate-900/60 p-4">
              <div className="flex items-center gap-2 text-emerald-400 mb-1.5">{p.icon}</div>
              <div className="text-xs text-slate-400 uppercase tracking-wide">{p.label}</div>
              <div className="text-sm font-medium text-slate-200 font-mono mt-0.5">{p.value}</div>
            </div>
          ))}
        </div>
      </Panel>
    </div>
  );
}

/** Compact system-status banner + jump-to-control-panel card. */
function SystemStatusCard({
  sys,
  onNavigate,
  canManage,
}: {
  sys: SystemStateResponse | null;
  onNavigate: (id: "system") => void;
  canManage: boolean;
}) {
  if (!sys) {
    return (
      <Panel className="lg:col-span-1">
        <PanelHeader title="System Status" subtitle="Loading…" icon={<Power className="h-4 w-4" />} />
        <div className="p-4">
          <div className="h-16 rounded-lg bg-slate-800/40 animate-pulse" />
        </div>
      </Panel>
    );
  }
  const s = sys.state;
  const counts = sys.counts;
  return (
    <Panel className={cn("lg:col-span-1", s.lockdown && "border-rose-500/40")}>
      <PanelHeader
        title="System Status"
        subtitle="Live system-wide state"
        icon={s.lockdown ? <AlertOctagon className="h-4 w-4 text-rose-400" /> : s.active ? <Power className="h-4 w-4 text-emerald-400" /> : <PowerOff className="h-4 w-4 text-amber-400" />}
        action={canManage ? (
          <button onClick={() => onNavigate("system")} className="inline-flex items-center gap-1 text-xs text-emerald-400 hover:text-emerald-300">
            Control panel <ChevronRight className="h-3 w-3" />
          </button>
        ) : undefined}
      />
      <div className="p-4 space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-xs text-slate-400">System</span>
          <Badge className={s.active ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300" : "border-amber-500/40 bg-amber-500/10 text-amber-300"}>
            <span className={cn("h-1.5 w-1.5 rounded-full", s.active ? "bg-emerald-400" : "bg-amber-400")} />
            {s.active ? "Active" : "Deactivated"}
          </Badge>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-xs text-slate-400">Lockdown</span>
          <Badge className={s.lockdown ? "border-rose-500/40 bg-rose-500/10 text-rose-300" : "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"}>
            <span className={cn("h-1.5 w-1.5 rounded-full", s.lockdown ? "bg-rose-400" : "bg-emerald-400")} />
            {s.lockdown ? "Active" : "Clear"}
          </Badge>
        </div>
        {s.lockdown && s.lockedBy && (
          <div className="text-[11px] text-rose-300">
            Locked by <span className="font-mono">{s.lockedBy}</span>{s.lockedAt && <> · {formatRelativeTime(s.lockedAt)}</>}
          </div>
        )}
        <div className="grid grid-cols-2 gap-2 pt-2 border-t border-slate-800">
          <div>
            <div className="text-[10px] text-slate-500 uppercase tracking-wide">Devices</div>
            <div className="text-sm font-mono text-slate-200">{counts.activeDevices} <span className="text-slate-500">/ {counts.devices}</span></div>
          </div>
          <div>
            <div className="text-[10px] text-slate-500 uppercase tracking-wide">Licenses</div>
            <div className="text-sm font-mono text-slate-200">{counts.activeLicenses} <span className="text-slate-500">/ {counts.licenses}</span></div>
          </div>
        </div>
      </div>
    </Panel>
  );
}

/** Security settings card — 2FA enable/disable for the current user. */
function SecuritySettingsCard() {
  const { user } = useAuth();
  const [enableOpen, setEnableOpen] = useState(false);
  const [disableOpen, setDisableOpen] = useState(false);

  if (!user) return null;

  return (
    <>
      <Panel className="lg:col-span-2">
        <PanelHeader
          title="Security Settings"
          subtitle="Two-factor authentication for your account"
          icon={<ShieldCheck className="h-4 w-4" />}
        />
        <div className="p-4 space-y-3">
          <div className="flex items-start gap-3">
            <div className={cn(
              "flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ring-1",
              user.twoFactorEnabled
                ? "bg-emerald-500/15 text-emerald-400 ring-emerald-500/30"
                : "bg-amber-500/15 text-amber-400 ring-amber-500/30"
            )}>
              <Smartphone className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-medium text-slate-200">Two-Factor Authentication</span>
                <Badge className={user.twoFactorEnabled ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300" : "border-amber-500/40 bg-amber-500/10 text-amber-300"}>
                  {user.twoFactorEnabled ? "Enabled" : "Disabled"}
                </Badge>
                {user.twoFactorEnforced && !user.twoFactorEnabled && (
                  <Badge className="border-rose-500/40 bg-rose-500/10 text-rose-300">
                    <ShieldAlert className="h-3 w-3" /> Enforced
                  </Badge>
                )}
              </div>
              <p className="text-[11px] text-slate-500 mt-0.5">
                {user.twoFactorEnabled
                  ? "Your account requires a TOTP code (or backup code) on every login."
                  : user.twoFactorEnforced
                    ? "Your role requires 2FA — enable it now to comply with policy."
                    : "Add a TOTP factor so a stolen password alone can't compromise your account."}
              </p>
            </div>
          </div>
          <div className="flex gap-2">
            {user.twoFactorEnabled ? (
              <Button
                onClick={() => setDisableOpen(true)}
                variant="outline"
                className="border-rose-500/40 text-rose-300 hover:bg-rose-500/10 hover:text-rose-200"
              >
                <ShieldAlert className="h-4 w-4" />
                Disable 2FA
              </Button>
            ) : (
              <Button
                onClick={() => setEnableOpen(true)}
                className="bg-emerald-600 hover:bg-emerald-500 text-white"
              >
                <ShieldCheck className="h-4 w-4" /> Enable 2FA
              </Button>
            )}
          </div>
        </div>
      </Panel>

      <Enable2faDialog open={enableOpen} onOpenChange={setEnableOpen} />
      <Disable2faDialog open={disableOpen} onOpenChange={setDisableOpen} />
    </>
  );
}

function HierarchyRow({ node, depth }: { node: HierarchyNode; depth: number }) {
  const meta = BRANCH_TYPE_META[node.type as BranchType] ?? BRANCH_TYPE_META.DEPARTMENT;
  return (
    <>
      <div
        className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-slate-800/40 transition-colors"
        style={{ paddingLeft: `${depth * 1.5 + 0.5}rem` }}
      >
        {depth > 0 && <div className="h-px w-3 bg-slate-700 shrink-0" />}
        <span className={cn("h-2 w-2 rounded-full shrink-0", meta.dot)} />
        <span className="text-sm font-medium text-slate-200 min-w-0 truncate">{node.name}</span>
        <span className="text-[10px] font-mono text-slate-500 shrink-0">{node.code}</span>
        <div className="ml-auto flex items-center gap-1.5 shrink-0">
          <Badge className="border-slate-700 bg-slate-800/60 text-slate-400">
            <KeyRound className="h-3 w-3" /> {node.keyCount}
          </Badge>
          {node.receivedCount > 0 && (
            <Badge className="border-emerald-500/30 bg-emerald-500/10 text-emerald-300">
              {node.receivedCount} in
            </Badge>
          )}
          {node.sentCount > 0 && (
            <Badge className="border-teal-500/30 bg-teal-500/10 text-teal-300">
              {node.sentCount} out
            </Badge>
          )}
        </div>
      </div>
      {node.children.map((child) => (
        <HierarchyRow key={child.id} node={child} depth={depth + 1} />
      ))}
    </>
  );
}
