"use client";

import { useEffect, useState, useCallback } from "react";
import {
  ShieldCheck,
  ShieldAlert,
  Power,
  PowerOff,
  AlertOctagon,
  Unlock,
  Loader2,
  Copy,
  Check,
  Fingerprint,
  KeyRound,
  Skull,
  Lock,
  Server,
  Activity,
} from "lucide-react";
import { api } from "@/lib/api";
import type { SystemStateResponse, KeyRecord } from "@/lib/types";
import { shortHash, formatDateTime, formatRelativeTime } from "@/lib/format";
import { Panel, PanelHeader, StatCard, Badge, EmptyState } from "./shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

/**
 * Owner Control Panel.
 *
 * Surfaces the system-wide kill-switches:
 *  - activate / deactivate the system
 *  - emergency lockdown (revokes all non-owner sessions) + release
 *  - licensing public key + fingerprint (for offline license verification)
 *  - cryptographic key destruction (owner-only remote wipe)
 *
 * Every action calls an owner-gated API endpoint, toasts the result, and
 * refreshes the cached system state so the header banner stays in sync.
 */
export function SystemSection() {
  const [state, setState] = useState<SystemStateResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [action, setAction] = useState<null | "activate" | "deactivate" | "lockdown" | "release">(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const { toast } = useToast();

  const load = useCallback(async () => {
    try {
      const res = await api.systemState();
      setState(res);
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
        const res = await api.systemState();
        if (isMounted) setState(res);
      } catch {
        /* 401 handled centrally */
      } finally {
        if (isMounted) setLoading(false);
      }
    };
    loadData();
    return () => { isMounted = false; };
  }, []);

  const runAction = async () => {
    setBusy(true);
    try {
      if (action === "activate") {
        await api.activateSystem();
        toast({ title: "System activated", description: "All services resumed for non-owner users." });
      } else if (action === "deactivate") {
        await api.deactivateSystem(reason || "Deactivated by owner");
        toast({
          title: "System deactivated",
          description: "All non-owner logins and document transfers are blocked.",
          variant: "destructive",
        });
      } else if (action === "lockdown") {
        const res = await api.lockdown(reason || "Emergency lockdown");
        toast({
          title: "Emergency lockdown active",
          description: `All non-owner sessions revoked (${res.sessionsRevoked}). Only the owner can release the lockdown.`,
          variant: "destructive",
        });
      } else if (action === "release") {
        await api.releaseLockdown();
        toast({ title: "Lockdown released", description: "Normal operations resumed." });
      }
      setAction(null);
      setReason("");
      await load();
    } catch (e) {
      toast({
        title: "Action failed",
        description: e instanceof Error ? e.message : "Error",
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  };

  const closeAction = (o: boolean) => {
    if (!o) {
      setAction(null);
      setReason("");
    }
  };

  if (loading || !state) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-28 rounded-xl bg-slate-900/60 border border-slate-800 animate-pulse" />
        ))}
      </div>
    );
  }

  const s = state.state;
  const counts = state.counts;
  const licensing = state.licensing;

  return (
    <div className="space-y-5">
      {/* Status hero + stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
        <StatCard
          label="System"
          value={s.active ? "ACTIVE" : "DEACTIVATED"}
          sub={s.active ? "all services online" : "non-owner access blocked"}
          icon={s.active ? <Power className="h-5 w-5" /> : <PowerOff className="h-5 w-5" />}
          accent={s.active ? "emerald" : "amber"}
        />
        <StatCard
          label="Lockdown"
          value={s.lockdown ? "ACTIVE" : "CLEAR"}
          sub={s.lockedAt ? `${s.lockedBy} · ${formatRelativeTime(s.lockedAt)}` : "no emergency"}
          icon={s.lockdown ? <AlertOctagon className="h-5 w-5" /> : <ShieldCheck className="h-5 w-5" />}
          accent={s.lockdown ? "rose" : "emerald"}
        />
        <StatCard
          label="Users"
          value={counts.activeUsers}
          sub={`${counts.suspendedUsers} suspended · ${counts.users} total`}
          icon={<Activity className="h-5 w-5" />}
          accent="teal"
        />
        <StatCard
          label="Devices / Licenses"
          value={`${counts.activeDevices} / ${counts.activeLicenses}`}
          sub={`${counts.revokedDevices} revoked devices · ${counts.revokedLicenses} revoked licenses`}
          icon={<Server className="h-5 w-5" />}
          accent="cyan"
        />
      </div>

      {/* Status + lockdown detail */}
      {s.lockdown && (
        <Panel className="border-rose-500/40 bg-rose-500/5">
          <div className="p-4 flex items-start gap-3">
            <AlertOctagon className="h-5 w-5 text-rose-400 shrink-0 mt-0.5" />
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold text-rose-200">Emergency Lockdown Active</div>
              <div className="text-xs text-slate-300 mt-0.5">
                {s.lockedBy && <>Initiated by <span className="font-mono text-rose-300">{s.lockedBy}</span> · </>}
                {s.lockedAt && <>{formatDateTime(s.lockedAt)}</>}
              </div>
              {s.lockdownReason && (
                <div className="text-xs text-slate-400 mt-1">Reason: {s.lockdownReason}</div>
              )}
            </div>
          </div>
        </Panel>
      )}

      {/* Action buttons */}
      <Panel>
        <PanelHeader
          title="System Control"
          subtitle="Owner-only kill switches. All actions are fully audited."
          icon={<ShieldAlert className="h-4 w-4" />}
        />
        <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-3">
          {/* Activate / Deactivate */}
          <div className="rounded-lg border border-slate-800 bg-slate-950/40 p-4">
            <div className="flex items-start gap-3 mb-3">
              <div className={cn(
                "flex h-9 w-9 items-center justify-center rounded-md",
                s.active
                  ? "bg-emerald-500/15 text-emerald-400 ring-1 ring-emerald-500/30"
                  : "bg-amber-500/15 text-amber-400 ring-1 ring-amber-500/30"
              )}>
                {s.active ? <Power className="h-4 w-4" /> : <PowerOff className="h-4 w-4" />}
              </div>
              <div className="min-w-0">
                <div className="text-sm font-medium text-slate-200">System Activation</div>
                <div className="text-[11px] text-slate-500">
                  {s.active
                    ? "Deactivate to block all non-owner logins and document transfers."
                    : "Re-activate the system to restore normal access."}
                </div>
              </div>
            </div>
            {s.active ? (
              <Button
                onClick={() => { setAction("deactivate"); setReason(""); }}
                variant="outline"
                className="w-full border-amber-500/40 text-amber-300 hover:bg-amber-500/10 hover:text-amber-200"
              >
                <PowerOff className="h-4 w-4" /> Deactivate System
              </Button>
            ) : (
              <Button
                onClick={() => setAction("activate")}
                className="w-full bg-emerald-600 hover:bg-emerald-500 text-white"
              >
                <Power className="h-4 w-4" /> Activate System
              </Button>
            )}
          </div>

          {/* Lockdown */}
          <div className={cn(
            "rounded-lg border p-4",
            s.lockdown ? "border-rose-500/40 bg-rose-500/5" : "border-rose-500/30 bg-rose-500/[0.03]"
          )}>
            <div className="flex items-start gap-3 mb-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-md bg-rose-500/15 text-rose-400 ring-1 ring-rose-500/30">
                <AlertOctagon className="h-4 w-4" />
              </div>
              <div className="min-w-0">
                <div className="text-sm font-medium text-slate-200">Emergency Lockdown</div>
                <div className="text-[11px] text-slate-500">
                  Immediately revokes every non-owner session and blocks new logins.
                </div>
              </div>
            </div>
            {s.lockdown ? (
              <Button
                onClick={() => setAction("release")}
                className="w-full bg-emerald-600 hover:bg-emerald-500 text-white"
              >
                <Unlock className="h-4 w-4" /> Release Lockdown
              </Button>
            ) : (
              <Button
                onClick={() => { setAction("lockdown"); setReason(""); }}
                className="w-full bg-rose-600 hover:bg-rose-500 text-white"
              >
                <AlertOctagon className="h-4 w-4" /> Initiate Lockdown
              </Button>
            )}
          </div>
        </div>
      </Panel>

      {/* Licensing public key */}
      <Panel>
        <PanelHeader
          title="Licensing Public Key"
          subtitle="Used to verify ECDSA-P521-SHA512 license signatures offline"
          icon={<KeyRound className="h-4 w-4" />}
          action={
            <CopyButton text={licensing.publicKey} label="Copy PEM" />
          }
        />
        <div className="p-4 space-y-3">
          <div className="rounded-lg border border-slate-800 bg-slate-950/50 p-3 flex items-center gap-2">
            <Fingerprint className="h-3.5 w-3.5 text-emerald-400" />
            <span className="text-[10px] text-slate-500 uppercase tracking-wide">Fingerprint (SHA-256):</span>
            <span className="font-mono text-[11px] text-emerald-300 break-all">{licensing.fingerprint}</span>
          </div>
          <pre className="font-mono text-[10px] leading-relaxed text-slate-300 whitespace-pre-wrap break-all max-h-56 overflow-y-auto rounded-lg border border-slate-800 bg-slate-950/50 p-3">
            {licensing.publicKey}
          </pre>
        </div>
      </Panel>

      {/* Key destruction */}
      <KeyDestructionPanel toast={toast} />

      {/* Action confirmation dialogs */}
      <Dialog open={action === "deactivate" || action === "lockdown"} onOpenChange={closeAction}>
        <DialogContent className="bg-slate-900 border-slate-700 text-slate-100 max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-slate-100">
              {action === "lockdown" ? (
                <AlertOctagon className="h-5 w-5 text-rose-400" />
              ) : (
                <PowerOff className="h-5 w-5 text-amber-400" />
              )}
              {action === "lockdown" ? "Initiate Emergency Lockdown" : "Deactivate System"}
            </DialogTitle>
            <DialogDescription className="text-slate-400">
              {action === "lockdown" ? (
                <>
                  All non-owner sessions will be <span className="text-rose-300">immediately revoked</span> and
                  no new non-owner logins will succeed. Only the owner can release the lockdown.
                </>
              ) : (
                <>
                  The system will be marked <span className="text-amber-300">deactivated</span>. Existing
                  sessions are kept, but every API guarded by <code className="text-slate-300">requireSystemActive()</code> will reject non-owner users.
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5 py-2">
            <Label className="text-slate-300 text-xs">Reason (optional)</Label>
            <Textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={
                action === "lockdown"
                  ? "e.g. Suspected breach — revoking all access until verified"
                  : "e.g. Scheduled maintenance"
              }
              className="bg-slate-950/60 border-slate-700 text-slate-100 min-h-[80px]"
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => closeAction(false)} className="text-slate-300 hover:bg-slate-800">
              Cancel
            </Button>
            <Button
              onClick={runAction}
              disabled={busy}
              className={cn(
                "text-white",
                action === "lockdown"
                  ? "bg-rose-600 hover:bg-rose-500"
                  : "bg-amber-600 hover:bg-amber-500"
              )}
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : action === "lockdown" ? <AlertOctagon className="h-4 w-4" /> : <PowerOff className="h-4 w-4" />}
              {action === "lockdown" ? "Confirm Lockdown" : "Confirm Deactivation"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={action === "activate"} onOpenChange={closeAction}>
        <AlertDialogContent className="bg-slate-900 border-slate-700 text-slate-100">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <Power className="h-5 w-5 text-emerald-400" /> Activate System?
            </AlertDialogTitle>
            <AlertDialogDescription className="text-slate-400">
              The system will return to active status. All non-owner users will be able to log in and
              exchange documents normally (subject to any active lockdown).
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="bg-slate-800 border-slate-700 text-slate-200 hover:bg-slate-700">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={runAction}
              disabled={busy}
              className="bg-emerald-600 hover:bg-emerald-500 text-white"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Power className="h-4 w-4 mr-1" />}
              Activate
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={action === "release"} onOpenChange={closeAction}>
        <AlertDialogContent className="bg-slate-900 border-slate-700 text-slate-100">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <Unlock className="h-5 w-5 text-emerald-400" /> Release Lockdown?
            </AlertDialogTitle>
            <AlertDialogDescription className="text-slate-400">
              The emergency lockdown will be lifted. Users may sign in again (their previous sessions were
              already revoked — they'll need to re-authenticate).
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="bg-slate-800 border-slate-700 text-slate-200 hover:bg-slate-700">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={runAction}
              disabled={busy}
              className="bg-emerald-600 hover:bg-emerald-500 text-white"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Unlock className="h-4 w-4 mr-1" />}
              Release Lockdown
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/** Sub-panel: list every key with a "Destroy Key" button (owner only). */
function KeyDestructionPanel({ toast }: { toast: ReturnType<typeof useToast>["toast"] }) {
  const [keys, setKeys] = useState<KeyRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [target, setTarget] = useState<KeyRecord | null>(null);
  const [purge, setPurge] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await api.keys();
      setKeys(res.keys);
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let isMounted = true;
    const loadData = async () => {
      try {
        const res = await api.keys();
        if (isMounted) setKeys(res.keys);
      } catch {
        /* ignore */
      } finally {
        if (isMounted) setLoading(false);
      }
    };
    loadData();
    return () => { isMounted = false; };
  }, []);

  const handleDestroy = async () => {
    if (!target) return;
    setBusy(true);
    try {
      const res = await api.revokeKey(target.id, purge);
      toast({
        title: "Key destroyed",
        description: purge
          ? `${target.branch.code} ${target.purpose} key v${target.version} cryptographically destroyed. ${res.purgedDocuments} document(s) purged.`
          : `${target.branch.code} ${target.purpose} key v${target.version} cryptographically destroyed. Documents encrypted with it are now unrecoverable.`,
        variant: "destructive",
      });
      setTarget(null);
      setPurge(false);
      await load();
    } catch (e) {
      toast({
        title: "Failed to destroy key",
        description: e instanceof Error ? e.message : "Error",
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  };

  const activeKeys = keys.filter((k) => k.status === "ACTIVE" || k.status === "ROTATED");

  return (
    <Panel className="border-rose-500/30">
      <PanelHeader
        title="Cryptographic Key Destruction"
        subtitle="Owner-only remote wipe — encrypted private key material is overwritten with zeros"
        icon={<Skull className="h-4 w-4 text-rose-400" />}
      />
      <div className="p-2">
        {loading ? (
          <div className="space-y-2 p-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-12 rounded-lg bg-slate-800/40 animate-pulse" />
            ))}
          </div>
        ) : activeKeys.length === 0 ? (
          <EmptyState icon={<Skull className="h-10 w-10" />} title="No destroyable keys" description="All keys have already been destroyed." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[11px] text-slate-500 uppercase tracking-wide border-b border-slate-800">
                  <th className="text-left font-medium px-3 py-2">Branch</th>
                  <th className="text-left font-medium px-3 py-2">Purpose</th>
                  <th className="text-left font-medium px-3 py-2 hidden md:table-cell">Fingerprint</th>
                  <th className="text-center font-medium px-3 py-2">Ver</th>
                  <th className="text-left font-medium px-3 py-2">Status</th>
                  <th className="text-right font-medium px-3 py-2">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/70">
                {activeKeys.map((k) => (
                  <tr key={k.id} className="hover:bg-slate-800/30">
                    <td className="px-3 py-2.5">
                      <div className="font-mono text-xs text-emerald-400">{k.branch.code}</div>
                      <div className="text-[10px] text-slate-500 truncate max-w-[140px]">{k.branch.name}</div>
                    </td>
                    <td className="px-3 py-2.5">
                      <Badge className={cn(
                        "border",
                        k.purpose === "ENCRYPTION"
                          ? "border-cyan-500/40 bg-cyan-500/10 text-cyan-300"
                          : "border-violet-500/40 bg-violet-500/10 text-violet-300"
                      )}>
                        {k.purpose === "ENCRYPTION" ? <Lock className="h-3 w-3" /> : <KeyRound className="h-3 w-3" />}
                        {k.purpose}
                      </Badge>
                    </td>
                    <td className="px-3 py-2.5 hidden md:table-cell">
                      <span className="font-mono text-[11px] text-slate-400">{shortHash(k.fingerprint, 10, 6)}</span>
                    </td>
                    <td className="px-3 py-2.5 text-center">
                      <span className="font-mono text-xs text-slate-300">v{k.version}</span>
                    </td>
                    <td className="px-3 py-2.5">
                      <Badge className={cn(
                        "border",
                        k.status === "ACTIVE"
                          ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
                          : "border-slate-600 bg-slate-700/30 text-slate-400"
                      )}>
                        {k.status}
                      </Badge>
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex items-center justify-end">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => { setTarget(k); setPurge(false); }}
                          className="text-rose-400 hover:text-rose-300 hover:bg-rose-500/10 h-8 px-2"
                          title="Cryptographically destroy this key"
                        >
                          <Skull className="h-4 w-4" />
                          <span className="ml-1 text-xs hidden md:inline">Destroy</span>
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <AlertDialog open={!!target} onOpenChange={(o) => { if (!o) { setTarget(null); setPurge(false); } }}>
        <AlertDialogContent className="bg-slate-900 border-slate-700 text-slate-100">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <Skull className="h-5 w-5 text-rose-400" /> Cryptographically destroy this key?
            </AlertDialogTitle>
            <AlertDialogDescription className="text-slate-400">
              {target && (
                <>
                  The encrypted private key material for{" "}
                  <span className="font-mono text-emerald-400">{target.branch.code}</span>{" "}
                  {target.purpose.toLowerCase()} key v{target.version} will be{" "}
                  <span className="text-rose-300">overwritten with non-decryptable garbage</span>.
                  Documents encrypted with this key will be permanently unrecoverable — even by the owner.
                  This action is irreversible.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="my-2 flex items-start gap-2 rounded-lg border border-rose-500/40 bg-rose-500/10 p-3">
            <input
              type="checkbox"
              id="purgeDocs"
              checked={purge}
              onChange={(e) => setPurge(e.target.checked)}
              className="mt-0.5 accent-rose-500"
            />
            <label htmlFor="purgeDocs" className="text-xs text-slate-300 cursor-pointer">
              <span className="font-medium text-rose-200">Also purge ciphertext blobs</span> — physically
              delete all document files encrypted with this key from disk. The corresponding Document rows
              will be marked PURGED.
            </label>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel className="bg-slate-800 border-slate-700 text-slate-200 hover:bg-slate-700">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDestroy}
              disabled={busy}
              className="bg-rose-600 hover:bg-rose-500 text-white"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Skull className="h-4 w-4 mr-1" />}
              Destroy Key
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Panel>
  );
}

function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        } catch {
          /* ignore */
        }
      }}
      className="inline-flex items-center gap-1 text-xs text-slate-400 hover:text-emerald-300 transition-colors"
    >
      {copied ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
      {copied ? "Copied" : label}
    </button>
  );
}
