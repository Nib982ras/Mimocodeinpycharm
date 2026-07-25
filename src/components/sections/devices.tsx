"use client";

import { useEffect, useState, useCallback } from "react";
import {
  Cpu,
  Plus,
  Loader2,
  Ban,
  Fingerprint,
  Wifi,
  ShieldAlert,
} from "lucide-react";
import { api } from "@/lib/api";
import type { DeviceRecord } from "@/lib/types";
import { shortHash, formatRelativeTime } from "@/lib/format";
import { Panel, PanelHeader, Badge, EmptyState } from "./shared";
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

/** A realistic-looking placeholder PEM so the demo isn't a blank textarea. */
const SAMPLE_PEM = `-----BEGIN PUBLIC KEY-----
MIGbMBAGByqGSM49AgEGBSuBBAAjA4GGAAQBk9J5xLk2N0+5v7n3m8oQp7HgVrR
J8ZSPkQp3tQF2n5h9t3Y5eK7vL2W8x1p6q4r9s0t7u3v1w2x4y6z8a0b1c3d5e7
f9h2j4k6m8n0p2q4r6s8t0u2v4w6x8y0z1a2b3c4d5e6f7g8h9i0j1k2l3m4n5o6
p7q8r9s0t1u2v3w4x5y6z7a8b9c0d1e2f3g4h5i6j7k8l9m0n1o2p3q4r5s6t7
u8v9w0x1y2z3a4b5c6d7e8f9g0h1i2j3k4l5m6n7o8p9q0r1s2t3u4v5w6x7y8z9
-----END PUBLIC KEY-----`;

export function DevicesSection() {
  const [devices, setDevices] = useState<DeviceRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [addOpen, setAddOpen] = useState(false);
  const [revokeTarget, setRevokeTarget] = useState<DeviceRecord | null>(null);
  const { toast } = useToast();

  const load = useCallback(async () => {
    try {
      const res = await api.devices();
      setDevices(res.devices);
    } catch {
      // 401 → auth:unauthorized event flips to login; other errors keep state.
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let isMounted = true;
    const loadData = async () => {
      try {
        const res = await api.devices();
        if (isMounted) setDevices(res.devices);
      } catch {
        // 401 → auth:unauthorized event flips to login; other errors keep state.
      } finally {
        if (isMounted) setLoading(false);
      }
    };
    loadData();
    return () => { isMounted = false; };
  }, []);

  const activeCount = devices.filter((d) => d.status === "ACTIVE").length;

  return (
    <div className="space-y-5">
      <Panel>
        <PanelHeader
          title="Registered Devices"
          subtitle={`${devices.length} devices · ${activeCount} active · public-key bound licenses`}
          icon={<Cpu className="h-4 w-4" />}
          action={
            <Button size="sm" onClick={() => setAddOpen(true)} className="bg-emerald-600 hover:bg-emerald-500 text-white">
              <Plus className="h-4 w-4" /> Register Device
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
          ) : devices.length === 0 ? (
            <EmptyState
              icon={<Cpu className="h-10 w-10" />}
              title="No devices registered"
              description="Register a device with its public key to issue a cryptographically signed license."
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-[11px] text-slate-500 uppercase tracking-wide border-b border-slate-800">
                    <th className="text-left font-medium px-3 py-2">Device</th>
                    <th className="text-left font-medium px-3 py-2 hidden md:table-cell">Owner</th>
                    <th className="text-left font-medium px-3 py-2 hidden lg:table-cell">Fingerprint</th>
                    <th className="text-left font-medium px-3 py-2">Status</th>
                    <th className="text-left font-medium px-3 py-2 hidden sm:table-cell">Last seen</th>
                    <th className="text-left font-medium px-3 py-2 hidden sm:table-cell">Created</th>
                    <th className="text-right font-medium px-3 py-2">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/70">
                  {devices.map((d) => {
                    const isActive = d.status === "ACTIVE";
                    return (
                      <tr key={d.id} className="hover:bg-slate-800/30 align-top">
                        <td className="px-3 py-2.5">
                          <div className="flex items-center gap-2">
                            <div className={cn(
                              "flex h-8 w-8 items-center justify-center rounded-md border",
                              isActive
                                ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-400"
                                : "border-slate-700 bg-slate-800/60 text-slate-500"
                            )}>
                              <Cpu className="h-4 w-4" />
                            </div>
                            <div className="min-w-0">
                              <div className="text-sm font-medium text-slate-200 truncate">{d.name}</div>
                              {d.license ? (
                                <div className="text-[10px] text-emerald-400 font-mono truncate">
                                  {d.license.tier} · {d.license.licenseKey}
                                </div>
                              ) : (
                                <div className="text-[10px] text-slate-500">no license</div>
                              )}
                            </div>
                          </div>
                        </td>
                        <td className="px-3 py-2.5 hidden md:table-cell">
                          {d.user ? (
                            <div className="min-w-0">
                              <div className="text-xs text-slate-200 truncate">{d.user.displayName}</div>
                              <div className="text-[10px] text-slate-500 font-mono">@{d.user.username}</div>
                              {d.user.branch && (
                                <div className="text-[10px] text-emerald-400 font-mono">{d.user.branch.code}</div>
                              )}
                            </div>
                          ) : (
                            <span className="text-xs text-slate-600">—</span>
                          )}
                        </td>
                        <td className="px-3 py-2.5 hidden lg:table-cell">
                          <button
                            type="button"
                            onClick={() => navigator.clipboard?.writeText(d.fingerprint)}
                            className="inline-flex items-center gap-1 font-mono text-[11px] text-slate-400 hover:text-emerald-300"
                            title="Click to copy"
                          >
                            <Fingerprint className="h-3 w-3" />
                            {shortHash(d.fingerprint, 10, 6)}
                          </button>
                        </td>
                        <td className="px-3 py-2.5">
                          {isActive ? (
                            <Badge className="border-emerald-500/40 bg-emerald-500/10 text-emerald-300">
                              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" /> Active
                            </Badge>
                          ) : (
                            <Badge className="border-rose-500/40 bg-rose-500/10 text-rose-300">
                              <span className="h-1.5 w-1.5 rounded-full bg-rose-400" /> Revoked
                            </Badge>
                          )}
                        </td>
                        <td className="px-3 py-2.5 hidden sm:table-cell">
                          {d.lastSeenAt ? (
                            <div className="flex items-center gap-1.5">
                              <Wifi className="h-3 w-3 text-emerald-400" />
                              <span className="text-[11px] text-slate-400">{formatRelativeTime(d.lastSeenAt)}</span>
                            </div>
                          ) : (
                            <span className="text-[11px] text-slate-600">never</span>
                          )}
                          {d.lastSeenIp && (
                            <div className="text-[10px] text-slate-600 font-mono truncate">{d.lastSeenIp}</div>
                          )}
                        </td>
                        <td className="px-3 py-2.5 hidden sm:table-cell">
                          <span className="text-[11px] text-slate-500">{formatRelativeTime(d.createdAt)}</span>
                        </td>
                        <td className="px-3 py-2.5">
                          <div className="flex items-center justify-end gap-1">
                            {isActive && (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setRevokeTarget(d)}
                                className="text-rose-400 hover:text-rose-300 hover:bg-rose-500/10 h-8 px-2"
                                title="Revoke device"
                              >
                                <Ban className="h-4 w-4" />
                                <span className="ml-1 text-xs hidden md:inline">Revoke</span>
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

      <RegisterDeviceDialog open={addOpen} onOpenChange={setAddOpen} onCreated={load} toast={toast} />
      <RevokeDeviceDialog
        target={revokeTarget}
        onClose={() => setRevokeTarget(null)}
        onDone={load}
        toast={toast}
      />
    </div>
  );
}

function RegisterDeviceDialog({
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
  const [name, setName] = useState("");
  const [publicKeyPem, setPublicKeyPem] = useState("");
  const [saving, setSaving] = useState(false);

  const reset = () => {
    setName("");
    setPublicKeyPem("");
  };

  const handleSave = async () => {
    if (!name || !publicKeyPem) {
      toast({ title: "Missing fields", description: "Name and public key are required.", variant: "destructive" });
      return;
    }
    if (!/-----BEGIN PUBLIC KEY-----/.test(publicKeyPem)) {
      toast({
        title: "Invalid key",
        description: "Public key must be a PEM-encoded PUBLIC KEY block.",
        variant: "destructive",
      });
      return;
    }
    setSaving(true);
    try {
      const res = await api.registerDevice(name, publicKeyPem);
      toast({
        title: "Device registered",
        description: `${res.device.name} → fingerprint ${shortHash(res.device.fingerprint, 8, 6)}.`,
      });
      reset();
      onOpenChange(false);
      await onCreated();
    } catch (e) {
      toast({
        title: "Failed to register device",
        description: e instanceof Error ? e.message : "Error",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) reset(); }}>
      <DialogContent className="bg-slate-900 border-slate-700 text-slate-100 max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-slate-100">
            <Cpu className="h-5 w-5 text-emerald-400" /> Register Device
          </DialogTitle>
          <DialogDescription className="text-slate-400">
            Bind a device's public key to the system. The fingerprint (SHA-256 of the PEM) becomes the device identity.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div className="space-y-1.5">
            <Label className="text-slate-300 text-xs">Device name</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. HQ-Tablet-03"
              className="bg-slate-950/60 border-slate-700 text-slate-100"
            />
          </div>
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label className="text-slate-300 text-xs">Public key (PEM)</Label>
              <button
                type="button"
                onClick={() => setPublicKeyPem(SAMPLE_PEM)}
                className="text-[10px] text-slate-500 hover:text-emerald-300"
              >
                Use sample key
              </button>
            </div>
            <Textarea
              value={publicKeyPem}
              onChange={(e) => setPublicKeyPem(e.target.value)}
              placeholder="-----BEGIN PUBLIC KEY-----&#10;...&#10;-----END PUBLIC KEY-----"
              className="bg-slate-950/60 border-slate-700 text-slate-100 font-mono text-[11px] min-h-[160px]"
            />
            <p className="text-[10px] text-slate-500">
              The SHA-256 hash of the PEM block becomes the unique device fingerprint. A duplicate key collides at the DB layer (409).
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} className="text-slate-300 hover:bg-slate-800">
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving} className="bg-emerald-600 hover:bg-emerald-500 text-white">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            Register
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RevokeDeviceDialog({
  target,
  onClose,
  onDone,
  toast,
}: {
  target: DeviceRecord | null;
  onClose: () => void;
  onDone: () => void;
  toast: ReturnType<typeof useToast>["toast"];
}) {
  const [busy, setBusy] = useState(false);
  const handleRevoke = async () => {
    if (!target) return;
    setBusy(true);
    try {
      await api.revokeDevice(target.id);
      toast({
        title: "Device revoked",
        description: target.license
          ? `${target.name} marked REVOKED — its license was also revoked.`
          : `${target.name} marked REVOKED.`,
        variant: "destructive",
      });
      onClose();
      await onDone();
    } catch (e) {
      toast({
        title: "Failed to revoke device",
        description: e instanceof Error ? e.message : "Error",
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  };
  return (
    <AlertDialog open={!!target} onOpenChange={(o) => !o && onClose()}>
      <AlertDialogContent className="bg-slate-900 border-slate-700 text-slate-100">
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <ShieldAlert className="h-5 w-5 text-rose-400" /> Revoke device?
          </AlertDialogTitle>
          <AlertDialogDescription className="text-slate-400">
            {target && (
              <>
                This will mark <span className="font-mono text-emerald-400">{target.name}</span> as REVOKED.
                Its license will also be revoked (status "Device revoked"). This action is irreversible —
                the device will fail all future license validations.
              </>
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel className="bg-slate-800 border-slate-700 text-slate-200 hover:bg-slate-700">
            Cancel
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={handleRevoke}
            disabled={busy}
            className="bg-rose-600 hover:bg-rose-500 text-white"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Ban className="h-4 w-4 mr-1" />}
            Revoke Device
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
