"use client";

import { useEffect, useState, useCallback } from "react";
import {
  BadgeCheck,
  Plus,
  Loader2,
  Ban,
  Fingerprint,
  Copy,
  Check,
  ShieldCheck,
  ShieldAlert,
  XCircle,
  Award,
  Calendar,
} from "lucide-react";
import { api } from "@/lib/api";
import type { LicenseRecord, LicenseTier, LicenseStatus, DeviceRecord } from "@/lib/types";
import { shortHash, formatRelativeTime } from "@/lib/format";
import { Panel, PanelHeader, Badge, EmptyState } from "./shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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

const TIER_META: Record<LicenseTier, { color: string; label: string }> = {
  ENTERPRISE: { color: "border-amber-500/40 bg-amber-500/10 text-amber-300", label: "Enterprise" },
  STANDARD: { color: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300", label: "Standard" },
  TRIAL: { color: "border-slate-600 bg-slate-700/30 text-slate-300", label: "Trial" },
};

const STATUS_META: Record<LicenseStatus, { color: string; dot: string; label: string }> = {
  ACTIVE: { color: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300", dot: "bg-emerald-400", label: "Active" },
  REVOKED: { color: "border-rose-500/40 bg-rose-500/10 text-rose-300", dot: "bg-rose-400", label: "Revoked" },
  SUSPENDED: { color: "border-amber-500/40 bg-amber-500/10 text-amber-300", dot: "bg-amber-400", label: "Suspended" },
  EXPIRED: { color: "border-slate-600 bg-slate-700/30 text-slate-400", dot: "bg-slate-400", label: "Expired" },
};

export function LicensesSection() {
  const [licenses, setLicenses] = useState<LicenseRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [issueOpen, setIssueOpen] = useState(false);
  const [revokeTarget, setRevokeTarget] = useState<LicenseRecord | null>(null);
  const [validateTarget, setValidateTarget] = useState<LicenseRecord | null>(null);
  const { toast } = useToast();

  const load = useCallback(async () => {
    try {
      const res = await api.licenses();
      setLicenses(res.licenses);
    } catch {
      // 401 handled centrally.
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const activeCount = licenses.filter((l) => l.status === "ACTIVE").length;

  return (
    <div className="space-y-5">
      <Panel>
        <PanelHeader
          title="Cryptographic Licenses"
          subtitle={`${licenses.length} licenses · ${activeCount} active · ECDSA-P521-SHA512 signed`}
          icon={<BadgeCheck className="h-4 w-4" />}
          action={
            <Button size="sm" onClick={() => setIssueOpen(true)} className="bg-emerald-600 hover:bg-emerald-500 text-white">
              <Plus className="h-4 w-4" /> Issue License
            </Button>
          }
        />
        <div className="p-2">
          {loading ? (
            <div className="space-y-2 p-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="h-14 rounded-lg bg-slate-800/40 animate-pulse" />
              ))}
            </div>
          ) : licenses.length === 0 ? (
            <EmptyState
              icon={<BadgeCheck className="h-10 w-10" />}
              title="No licenses issued"
              description="Issue a cryptographically signed license bound to a registered device."
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-[11px] text-slate-500 uppercase tracking-wide border-b border-slate-800">
                    <th className="text-left font-medium px-3 py-2">License Key</th>
                    <th className="text-left font-medium px-3 py-2 hidden md:table-cell">Device</th>
                    <th className="text-left font-medium px-3 py-2">Tier</th>
                    <th className="text-left font-medium px-3 py-2">Status</th>
                    <th className="text-left font-medium px-3 py-2 hidden sm:table-cell">Expires</th>
                    <th className="text-left font-medium px-3 py-2 hidden lg:table-cell">Signer</th>
                    <th className="text-right font-medium px-3 py-2">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/70">
                  {licenses.map((l) => {
                    const tier = TIER_META[l.tier as LicenseTier] ?? TIER_META.STANDARD;
                    const status = STATUS_META[l.status as LicenseStatus] ?? STATUS_META.ACTIVE;
                    const expired = l.status === "ACTIVE" && new Date(l.expiresAt).getTime() < Date.now();
                    const effectiveStatus = expired ? "EXPIRED" : l.status;
                    const effectiveMeta = expired ? STATUS_META.EXPIRED : status;
                    return (
                      <tr key={l.id} className="hover:bg-slate-800/30 align-top">
                        <td className="px-3 py-2.5">
                          <button
                            type="button"
                            onClick={() => navigator.clipboard?.writeText(l.licenseKey)}
                            className="inline-flex items-center gap-1.5 font-mono text-[11px] text-emerald-300 hover:text-emerald-200"
                            title="Click to copy"
                          >
                            <Copy className="h-3 w-3" />
                            {l.licenseKey}
                          </button>
                          {l.revokeReason && (
                            <div className="text-[10px] text-rose-400 mt-0.5 truncate max-w-[180px]">
                              ↳ {l.revokeReason}
                            </div>
                          )}
                        </td>
                        <td className="px-3 py-2.5 hidden md:table-cell">
                          {l.device ? (
                            <div className="min-w-0">
                              <div className="text-xs text-slate-200 truncate">{l.device.name}</div>
                              <div className="flex items-center gap-1 text-[10px] text-slate-500 font-mono">
                                <Fingerprint className="h-2.5 w-2.5" />
                                {shortHash(l.device.fingerprint, 8, 6)}
                              </div>
                              {l.device.owner && (
                                <div className="text-[10px] text-slate-500">@{l.device.owner.username}</div>
                              )}
                            </div>
                          ) : (
                            <span className="text-xs text-slate-600">—</span>
                          )}
                        </td>
                        <td className="px-3 py-2.5">
                          <Badge className={cn("border", tier.color)}>
                            <Award className="h-3 w-3" /> {tier.label}
                          </Badge>
                        </td>
                        <td className="px-3 py-2.5">
                          <Badge className={cn("border", effectiveMeta.color)}>
                            <span className={cn("h-1.5 w-1.5 rounded-full", effectiveMeta.dot)} />
                            {effectiveMeta.label}
                          </Badge>
                        </td>
                        <td className="px-3 py-2.5 hidden sm:table-cell">
                          <div className="flex items-center gap-1.5">
                            <Calendar className="h-3 w-3 text-slate-500" />
                            <span className={cn(
                              "text-[11px]",
                              expired ? "text-slate-500 line-through" : "text-slate-300"
                            )}>
                              {new Date(l.expiresAt).toLocaleDateString()}
                            </span>
                          </div>
                          <div className="text-[10px] text-slate-600">
                            issued {formatRelativeTime(l.issuedAt)}
                          </div>
                        </td>
                        <td className="px-3 py-2.5 hidden lg:table-cell">
                          <span className="font-mono text-[10px] text-slate-500">
                            {shortHash(l.signerFingerprint, 8, 6)}
                          </span>
                        </td>
                        <td className="px-3 py-2.5">
                          <div className="flex items-center justify-end gap-1">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => setValidateTarget(l)}
                              className="text-cyan-400 hover:text-cyan-300 hover:bg-cyan-500/10 h-8 w-8 p-0"
                              title="Validate license"
                            >
                              <ShieldCheck className="h-4 w-4" />
                            </Button>
                            {effectiveStatus === "ACTIVE" && (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setRevokeTarget(l)}
                                className="text-rose-400 hover:text-rose-300 hover:bg-rose-500/10 h-8 w-8 p-0"
                                title="Revoke license"
                              >
                                <Ban className="h-4 w-4" />
                              </Button>
                            )}
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

      <IssueLicenseDialog open={issueOpen} onOpenChange={setIssueOpen} onCreated={load} toast={toast} />
      <RevokeLicenseDialog
        target={revokeTarget}
        onClose={() => setRevokeTarget(null)}
        onDone={load}
        toast={toast}
      />
      <ValidateLicenseDialog target={validateTarget} onClose={() => setValidateTarget(null)} toast={toast} />
    </div>
  );
}

function IssueLicenseDialog({
  open,
  onOpenChange,
  onCreated,
  toast,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onCreated: () => void;
  toast: ReturnType<typeof useToast>["toast"];
}) {
  const [devices, setDevices] = useState<DeviceRecord[]>([]);
  const [deviceId, setDeviceId] = useState("");
  const [tier, setTier] = useState<LicenseTier>("STANDARD");
  const [expiresInDays, setExpiresInDays] = useState("365");
  const [saving, setSaving] = useState(false);
  const [issued, setIssued] = useState<LicenseRecord | null>(null);

  // Load devices when the dialog opens so the device dropdown is fresh.
  useEffect(() => {
    if (!open) return;
    api.devices()
      .then((res) => setDevices(res.devices.filter((d) => d.status === "ACTIVE")))
      .catch(() => setDevices([]));
  }, [open]);

  const reset = () => {
    setDeviceId("");
    setTier("STANDARD");
    setExpiresInDays("365");
    setIssued(null);
  };

  const handleSave = async () => {
    if (!deviceId) {
      toast({ title: "Select a device", description: "A target device is required.", variant: "destructive" });
      return;
    }
    const days = parseInt(expiresInDays, 10);
    if (!Number.isFinite(days) || days <= 0) {
      toast({ title: "Invalid expiry", description: "Expiry days must be a positive number.", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const res = await api.issueLicense(deviceId, tier, days);
      setIssued(res.license);
      toast({
        title: "License issued",
        description: `${res.license.tier} license signed with ECDSA-P521-SHA512.`,
      });
      await onCreated();
    } catch (e) {
      toast({
        title: "Failed to issue license",
        description: e instanceof Error ? e.message : "Error",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  const close = (o: boolean) => {
    onOpenChange(o);
    if (!o) setTimeout(reset, 200);
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="bg-slate-900 border-slate-700 text-slate-100 max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-slate-100">
            <BadgeCheck className="h-5 w-5 text-emerald-400" /> Issue Cryptographic License
          </DialogTitle>
          <DialogDescription className="text-slate-400">
            Sign a fresh license for a registered device using the system's ECDSA-P521-SHA512 licensing key.
          </DialogDescription>
        </DialogHeader>

        {issued ? (
          <div className="py-3 space-y-3">
            <div className="flex items-start gap-2 rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-3">
              <Check className="h-4 w-4 text-emerald-400 shrink-0 mt-0.5" />
              <div className="text-xs text-emerald-200">
                License issued and signed. Share the key + signature with the device owner.
              </div>
            </div>
            <CopyField label="License Key" value={issued.licenseKey} />
            {issued.signature && <CopyField label="Signature (base64 ECDSA)" value={issued.signature} multiline />}
            <CopyField
              label="Signer Fingerprint"
              value={issued.signerFingerprint}
            />
            <DialogFooter>
              <Button onClick={() => close(false)} className="bg-emerald-600 hover:bg-emerald-500 text-white">
                Done
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <>
            <div className="space-y-3 py-2">
              <div className="space-y-1.5">
                <Label className="text-slate-300 text-xs">Device</Label>
                <Select value={deviceId} onValueChange={setDeviceId}>
                  <SelectTrigger className="bg-slate-950/60 border-slate-700 text-slate-100">
                    <SelectValue placeholder={devices.length === 0 ? "No active devices" : "Select device"} />
                  </SelectTrigger>
                  <SelectContent className="bg-slate-900 border-slate-700 max-h-72">
                    {devices.map((d) => (
                      <SelectItem key={d.id} value={d.id} className="text-slate-100 focus:bg-slate-800">
                        <span className="text-xs">{d.name}</span>
                        <span className="text-[10px] text-slate-500 font-mono ml-2">
                          {shortHash(d.fingerprint, 6, 4)}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-slate-300 text-xs">Tier</Label>
                  <Select value={tier} onValueChange={(v) => setTier(v as LicenseTier)}>
                    <SelectTrigger className="bg-slate-950/60 border-slate-700 text-slate-100"><SelectValue /></SelectTrigger>
                    <SelectContent className="bg-slate-900 border-slate-700">
                      <SelectItem value="STANDARD" className="text-slate-100 focus:bg-slate-800">Standard</SelectItem>
                      <SelectItem value="ENTERPRISE" className="text-slate-100 focus:bg-slate-800">Enterprise</SelectItem>
                      <SelectItem value="TRIAL" className="text-slate-100 focus:bg-slate-800">Trial</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-slate-300 text-xs">Expires in (days)</Label>
                  <Input
                    type="number"
                    min={1}
                    value={expiresInDays}
                    onChange={(e) => setExpiresInDays(e.target.value)}
                    className="bg-slate-950/60 border-slate-700 text-slate-100"
                  />
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={() => close(false)} className="text-slate-300 hover:bg-slate-800">
                Cancel
              </Button>
              <Button onClick={handleSave} disabled={saving} className="bg-emerald-600 hover:bg-emerald-500 text-white">
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <BadgeCheck className="h-4 w-4" />}
                Issue & Sign
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function RevokeLicenseDialog({
  target,
  onClose,
  onDone,
  toast,
}: {
  target: LicenseRecord | null;
  onClose: () => void;
  onDone: () => void;
  toast: ReturnType<typeof useToast>["toast"];
}) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const handleRevoke = async () => {
    if (!target) return;
    setBusy(true);
    try {
      await api.revokeLicense(target.id, reason || undefined);
      toast({
        title: "License revoked",
        description: `License ${target.licenseKey} is now REVOKED.`,
        variant: "destructive",
      });
      setReason("");
      onClose();
      await onDone();
    } catch (e) {
      toast({
        title: "Failed to revoke license",
        description: e instanceof Error ? e.message : "Error",
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={!!target} onOpenChange={(o) => { if (!o) { setReason(""); onClose(); } }}>
      <DialogContent className="bg-slate-900 border-slate-700 text-slate-100 max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-slate-100">
            <ShieldAlert className="h-5 w-5 text-rose-400" /> Revoke License
          </DialogTitle>
          <DialogDescription className="text-slate-400">
            {target && (
              <>
                License <span className="font-mono text-emerald-400">{target.licenseKey}</span> will be marked REVOKED.
                The bound device will fail all future validations.
              </>
            )}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5 py-2">
          <Label className="text-slate-300 text-xs">Reason (optional)</Label>
          <Input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Device decommissioned"
            className="bg-slate-950/60 border-slate-700 text-slate-100"
          />
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} className="text-slate-300 hover:bg-slate-800">
            Cancel
          </Button>
          <Button onClick={handleRevoke} disabled={busy} className="bg-rose-600 hover:bg-rose-500 text-white">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Ban className="h-4 w-4" />}
            Revoke License
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ValidateLicenseDialog({
  target,
  onClose,
  toast,
}: {
  target: LicenseRecord | null;
  onClose: () => void;
  toast: ReturnType<typeof useToast>["toast"];
}) {
  // The actual validating inner component is keyed by `target.id` so a fresh
  // instance is mounted for each new license — its initial useState values
  // represent the "loading" state and we only call setState inside async
  // callbacks (never synchronously inside the effect body).
  return (
    <Dialog open={!!target} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="bg-slate-900 border-slate-700 text-slate-100 max-w-md">
        {target ? (
          <ValidateLicenseInner
            key={target.id}
            target={target}
            onClose={onClose}
            toast={toast}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function ValidateLicenseInner({
  target,
  onClose,
  toast,
}: {
  target: LicenseRecord;
  onClose: () => void;
  toast: ReturnType<typeof useToast>["toast"];
}) {
  const [busy, setBusy] = useState(true);
  const [result, setResult] = useState<{ valid: boolean; reason?: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .validateLicense(target.licenseKey, target.device?.fingerprint ?? "")
      .then((r) => {
        if (cancelled) return;
        setResult({ valid: r.valid, reason: r.reason });
        setBusy(false);
      })
      .catch((e) => {
        if (cancelled) return;
        setResult({ valid: false, reason: e instanceof Error ? e.message : "Validation failed" });
        setBusy(false);
        toast({
          title: "Validation error",
          description: e instanceof Error ? e.message : "Error",
          variant: "destructive",
        });
      });
    return () => { cancelled = true; };
  }, [target, toast]);

  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2 text-slate-100">
          <ShieldCheck className="h-5 w-5 text-cyan-400" /> License Validation
        </DialogTitle>
        <DialogDescription className="text-slate-400">
          Validating <span className="font-mono text-emerald-400">{target.licenseKey}</span> against the
          device fingerprint.
        </DialogDescription>
      </DialogHeader>
      <div className="py-3 space-y-3">
        {busy ? (
          <div className="flex items-center justify-center py-6 text-slate-400">
            <Loader2 className="h-5 w-5 animate-spin text-cyan-400" />
          </div>
        ) : result ? (
          <div
            className={cn(
              "flex items-start gap-3 rounded-lg border p-3",
              result.valid
                ? "border-emerald-500/40 bg-emerald-500/10"
                : "border-rose-500/40 bg-rose-500/10"
            )}
          >
            {result.valid ? (
              <ShieldCheck className="h-5 w-5 text-emerald-400 shrink-0 mt-0.5" />
            ) : (
              <XCircle className="h-5 w-5 text-rose-400 shrink-0 mt-0.5" />
            )}
            <div className="min-w-0">
              <div className={cn("text-sm font-medium", result.valid ? "text-emerald-200" : "text-rose-200")}>
                {result.valid ? "License is VALID" : "License is INVALID"}
              </div>
              {result.reason && (
                <div className="text-xs text-slate-400 mt-0.5">{result.reason}</div>
              )}
              <div className="mt-2 text-[10px] text-slate-500 font-mono break-all">
                {target.licenseKey} · {shortHash(target.device?.fingerprint ?? "", 10, 6)}
              </div>
            </div>
          </div>
        ) : null}
      </div>
      <DialogFooter>
        <Button variant="ghost" onClick={onClose} className="text-slate-300 hover:bg-slate-800">
          Close
        </Button>
      </DialogFooter>
    </>
  );
}

function CopyField({ label, value, multiline }: { label: string; value: string; multiline?: boolean }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="rounded-md border border-slate-800 bg-slate-950/50 p-2.5">
      <div className="flex items-center justify-between mb-1">
        <span className="text-[10px] text-slate-500 uppercase tracking-wide">{label}</span>
        <button
          type="button"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(value);
              setCopied(true);
              setTimeout(() => setCopied(false), 1200);
            } catch {
              /* ignore */
            }
          }}
          className="inline-flex items-center gap-1 text-[10px] text-slate-400 hover:text-emerald-300"
        >
          {copied ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <div className={cn("text-[11px] text-emerald-300 break-all leading-relaxed font-mono", multiline && "max-h-24 overflow-y-auto")}>
        {value}
      </div>
    </div>
  );
}
