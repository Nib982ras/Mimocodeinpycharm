"use client";

import { useEffect, useState, useCallback } from "react";
import {
  KeyRound,
  RefreshCw,
  Loader2,
  ShieldCheck,
  Fingerprint,
  Eye,
  Lock,
} from "lucide-react";
import { api } from "@/lib/api";
import type { KeyRecord, KeyPurpose, KeyStatus } from "@/lib/types";
import { shortHash, formatRelativeTime, formatDateTime } from "@/lib/format";
import { Panel, PanelHeader, Badge, EmptyState } from "./shared";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
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

const STATUS_META: Record<KeyStatus, { color: string; label: string }> = {
  ACTIVE: { color: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300", label: "Active" },
  ROTATED: { color: "border-slate-600 bg-slate-700/30 text-slate-400", label: "Rotated" },
  REVOKED: { color: "border-rose-500/40 bg-rose-500/10 text-rose-300", label: "Revoked" },
};

const PURPOSE_META: Record<KeyPurpose, { color: string; label: string; icon: string }> = {
  ENCRYPTION: { color: "text-cyan-300 border-cyan-500/40 bg-cyan-500/10", label: "ECDH Encryption", icon: "Lock" },
  SIGNING: { color: "text-violet-300 border-violet-500/40 bg-violet-500/10", label: "ECDSA Signing", icon: "PenTool" },
};

export function KeysSection() {
  const [keys, setKeys] = useState<KeyRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState<KeyRecord | null>(null);
  const [rotateTarget, setRotateTarget] = useState<KeyRecord | null>(null);
  const [rotating, setRotating] = useState(false);
  const { toast } = useToast();

  const load = useCallback(async () => {
    try {
      const res = await api.keys();
      setKeys(res.keys);
    } catch {
      // 401 → auth:unauthorized event flips to login; other errors keep state.
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const confirmRotate = async () => {
    if (!rotateTarget) return;
    setRotating(true);
    try {
      const res = await api.rotateKey(rotateTarget.id);
      toast({
        title: "Key rotated",
        description: `${rotateTarget.branch.code} ${rotateTarget.purpose} key → v${res.newKey.version}. Old key marked ROTATED.`,
      });
      setRotateTarget(null);
      await load();
    } catch (e) {
      toast({ title: "Rotation failed", description: e instanceof Error ? e.message : "Error", variant: "destructive" });
    } finally {
      setRotating(false);
    }
  };

  const activeCount = keys.filter((k) => k.status === "ACTIVE").length;

  return (
    <div className="space-y-5">
      <Panel>
        <PanelHeader
          title="ECC Key Vault"
          subtitle={`${keys.length} keys · ${activeCount} active · NIST P-521 (secp521r1)`}
          icon={<KeyRound className="h-4 w-4" />}
        />
        <div className="p-2">
          {loading ? (
            <div className="space-y-2 p-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="h-16 rounded-lg bg-slate-800/40 animate-pulse" />
              ))}
            </div>
          ) : keys.length === 0 ? (
            <EmptyState icon={<KeyRound className="h-10 w-10" />} title="No keys provisioned" />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-[11px] text-slate-500 uppercase tracking-wide border-b border-slate-800">
                    <th className="text-left font-medium px-3 py-2">Branch</th>
                    <th className="text-left font-medium px-3 py-2">Purpose</th>
                    <th className="text-left font-medium px-3 py-2 hidden md:table-cell">Algorithm</th>
                    <th className="text-left font-medium px-3 py-2 hidden lg:table-cell">Fingerprint</th>
                    <th className="text-center font-medium px-3 py-2">Ver</th>
                    <th className="text-left font-medium px-3 py-2">Status</th>
                    <th className="text-left font-medium px-3 py-2 hidden sm:table-cell">Created</th>
                    <th className="text-right font-medium px-3 py-2">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/70">
                  {keys.map((k) => {
                    const pm = PURPOSE_META[k.purpose];
                    const sm = STATUS_META[k.status as KeyStatus] ?? STATUS_META.ACTIVE;
                    return (
                      <tr key={k.id} className="hover:bg-slate-800/30">
                        <td className="px-3 py-2.5">
                          <div className="font-mono text-xs text-emerald-400">{k.branch.code}</div>
                          <div className="text-[11px] text-slate-500 truncate max-w-[160px]">{k.branch.name}</div>
                        </td>
                        <td className="px-3 py-2.5">
                          <Badge className={cn("border", pm.color)}>
                            {k.purpose === "ENCRYPTION" ? <Lock className="h-3 w-3" /> : <KeyRound className="h-3 w-3" />}
                            {pm.label}
                          </Badge>
                        </td>
                        <td className="px-3 py-2.5 hidden md:table-cell">
                          <span className="font-mono text-[11px] text-slate-400">{k.algorithm}</span>
                        </td>
                        <td className="px-3 py-2.5 hidden lg:table-cell">
                          <span className="font-mono text-[11px] text-slate-400">{shortHash(k.fingerprint, 12, 8)}</span>
                        </td>
                        <td className="px-3 py-2.5 text-center">
                          <span className="font-mono text-xs text-slate-300">v{k.version}</span>
                        </td>
                        <td className="px-3 py-2.5">
                          <Badge className={cn("border", sm.color)}>
                            <span className={cn("h-1.5 w-1.5 rounded-full", k.status === "ACTIVE" ? "bg-emerald-400" : k.status === "ROTATED" ? "bg-slate-400" : "bg-rose-400")} />
                            {sm.label}
                          </Badge>
                        </td>
                        <td className="px-3 py-2.5 hidden sm:table-cell">
                          <span className="text-[11px] text-slate-500">{formatRelativeTime(k.createdAt)}</span>
                        </td>
                        <td className="px-3 py-2.5">
                          <div className="flex items-center justify-end gap-1">
                            <Button variant="ghost" size="sm" onClick={() => setDetail(k)} className="text-slate-400 hover:text-slate-100 hover:bg-slate-800 h-8 w-8 p-0">
                              <Eye className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => setRotateTarget(k)}
                              disabled={k.status !== "ACTIVE"}
                              className="text-amber-400 hover:text-amber-300 hover:bg-amber-500/10 h-8 w-8 p-0 disabled:opacity-30"
                            >
                              <RefreshCw className="h-4 w-4" />
                            </Button>
                          </div>
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

      {/* Key detail dialog */}
      <Dialog open={!!detail} onOpenChange={(o) => !o && setDetail(null)}>
        <DialogContent className="bg-slate-900 border-slate-700 text-slate-100 max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-slate-100">
              <KeyRound className="h-5 w-5 text-emerald-400" /> Key Detail
            </DialogTitle>
            <DialogDescription className="text-slate-400">
              {detail && `${detail.branch.code} · ${PURPOSE_META[detail.purpose].label} · v${detail.version}`}
            </DialogDescription>
          </DialogHeader>
          {detail && (
            <div className="space-y-3 py-2">
              <div className="grid grid-cols-2 gap-3">
                <Info label="Algorithm" value={detail.algorithm} mono />
                <Info label="Curve" value={detail.curve} mono />
                <Info label="Status" value={STATUS_META[detail.status as KeyStatus]?.label ?? detail.status} />
                <Info label="Version" value={`v${detail.version}`} mono />
                <Info label="Created" value={formatDateTime(detail.createdAt)} />
                <Info label="Rotated" value={detail.rotatedAt ? formatDateTime(detail.rotatedAt) : "—"} />
              </div>
              <div className="rounded-lg border border-slate-800 bg-slate-950/50 p-3">
                <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide flex items-center gap-1.5 mb-1.5">
                  <Fingerprint className="h-3 w-3" /> Fingerprint (SHA-256)
                </div>
                <div className="font-mono text-[11px] text-emerald-300 break-all">{detail.fingerprint}</div>
              </div>
              <div className="rounded-lg border border-slate-800 bg-slate-950/50 p-3">
                <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide flex items-center gap-1.5 mb-1.5">
                  <ShieldCheck className="h-3 w-3" /> Public Key (SPKI PEM)
                </div>
                <pre className="font-mono text-[10px] leading-relaxed text-slate-300 whitespace-pre-wrap break-all max-h-48 overflow-y-auto">
                  {detail.publicKeyPem}
                </pre>
              </div>
              <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
                <Lock className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" />
                <p className="text-[11px] text-slate-400">
                  The private key is encrypted at rest with AES-256-GCM using a master key (HSM stand-in) and never leaves the server in plaintext.
                </p>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Rotate confirmation */}
      <AlertDialog open={!!rotateTarget} onOpenChange={(o) => !o && setRotateTarget(null)}>
        <AlertDialogContent className="bg-slate-900 border-slate-700 text-slate-100">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <RefreshCw className="h-5 w-5 text-amber-400" /> Rotate Key?
            </AlertDialogTitle>
            <AlertDialogDescription className="text-slate-400">
              {rotateTarget && (
                <>
                  This will mark the current <span className="font-mono text-emerald-400">{rotateTarget.branch.code}</span> {rotateTarget.purpose.toLowerCase()} key (v{rotateTarget.version}) as <span className="text-slate-200">ROTATED</span> and generate a new active key pair (v{rotateTarget.version + 1}). Existing documents remain decryptable with the rotated key.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="bg-slate-800 border-slate-700 text-slate-200 hover:bg-slate-700">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmRotate}
              disabled={rotating}
              className="bg-amber-600 hover:bg-amber-500 text-white"
            >
              {rotating ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <RefreshCw className="h-4 w-4 mr-1" />}
              Rotate Key
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function Info({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <div className="text-[10px] font-medium text-slate-500 uppercase tracking-wide">{label}</div>
      <div className={cn("text-sm text-slate-200", mono && "font-mono text-xs")}>{value}</div>
    </div>
  );
}
