"use client";

import { useEffect, useState, useCallback } from "react";
import {
  Users,
  UserPlus,
  Trash2,
  KeyRound,
  ShieldCheck,
  ShieldAlert,
  Loader2,
  Search,
  Ban,
  PlayCircle,
  Crown,
  UserCog,
  Eye,
} from "lucide-react";
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
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/components/auth-provider";
import { api } from "@/lib/api";
import { roleRank, type Role, type UserStatus } from "@/lib/types";
import { BRANCH_TYPE_META, formatRelativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";

const ALL_ROLES: Role[] = ["OWNER", "SECURITY_ADMIN", "BRANCH_ADMIN", "USER", "READONLY"];

const ROLE_META: Record<Role, { label: string; color: string; icon: typeof Crown }> = {
  OWNER: { label: "Owner", color: "border-amber-500/40 bg-amber-500/10 text-amber-300", icon: Crown },
  SECURITY_ADMIN: { label: "Sec Admin", color: "border-rose-500/40 bg-rose-500/10 text-rose-300", icon: ShieldCheck },
  BRANCH_ADMIN: { label: "Branch Admin", color: "border-violet-500/40 bg-violet-500/10 text-violet-300", icon: UserCog },
  USER: { label: "User", color: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300", icon: Users },
  READONLY: { label: "Read-only", color: "border-slate-600 bg-slate-700/30 text-slate-300", icon: Eye },
};

const STATUS_META: Record<UserStatus, { color: string; dot: string; label: string }> = {
  ACTIVE: { color: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300", dot: "bg-emerald-400", label: "Active" },
  SUSPENDED: { color: "border-amber-500/40 bg-amber-500/10 text-amber-300", dot: "bg-amber-400", label: "Suspended" },
  REVOKED: { color: "border-rose-500/40 bg-rose-500/10 text-rose-300", dot: "bg-rose-400", label: "Revoked" },
};

interface ManagedUser {
  id: string;
  username: string;
  displayName: string;
  role: Role;
  status: UserStatus;
  branchId: string | null;
  branch: { id: string; code: string; name: string; type: string } | null;
  twoFactorEnabled: boolean;
  twoFactorEnforced: boolean;
  createdAt: string;
}

interface BranchLite {
  id: string;
  code: string;
  name: string;
  type: string;
}

export function UsersSection() {
  const { user: me } = useAuth();
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [branches, setBranches] = useState<BranchLite[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ManagedUser | null>(null);
  const [pwTarget, setPwTarget] = useState<ManagedUser | null>(null);
  const [suspendTarget, setSuspendTarget] = useState<ManagedUser | null>(null);
  const { toast } = useToast();

  const load = useCallback(async () => {
    try {
      const [u, b] = await Promise.all([api.usersRaw(), api.branches()]);
      if (u.ok) setUsers(u.users);
      if (b.ok) setBranches(b.branches.map((x: BranchLite & { type: string }) => ({ id: x.id, code: x.code, name: x.name, type: x.type })));
    } catch {
      // network error — keep previous state
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let isMounted = true;
    const loadData = async () => {
      try {
        const [u, b] = await Promise.all([api.usersRaw(), api.branches()]);
        if (isMounted) {
          if (u.ok) setUsers(u.users);
          if (b.ok) setBranches(b.branches.map((x: BranchLite & { type: string }) => ({ id: x.id, code: x.code, name: x.name, type: x.type })));
        }
      } catch {
        // network error — keep previous state
      } finally {
        if (isMounted) setLoading(false);
      }
    };
    loadData();
    return () => { isMounted = false; };
  }, []);

  const filtered = users.filter((u) => {
    if (!query) return true;
    const q = query.toLowerCase();
    return (
      u.username.toLowerCase().includes(q) ||
      u.displayName.toLowerCase().includes(q) ||
      (u.branch?.code.toLowerCase().includes(q) ?? false)
    );
  });

  const activeCount = users.filter((u) => u.status === "ACTIVE").length;
  const suspendedCount = users.filter((u) => u.status === "SUSPENDED").length;
  const twoFaCount = users.filter((u) => u.twoFactorEnabled).length;

  return (
    <div className="space-y-5">
      <Panel>
        <PanelHeader
          title="User Accounts"
          subtitle={`${users.length} accounts · ${activeCount} active · ${suspendedCount} suspended · ${twoFaCount} with 2FA`}
          icon={<Users className="h-4 w-4" />}
          action={
            <Button size="sm" onClick={() => setAddOpen(true)} className="bg-emerald-600 hover:bg-emerald-500 text-white">
              <UserPlus className="h-4 w-4" /> Add User
            </Button>
          }
        />
        <div className="px-4 md:px-5 py-3 border-b border-slate-800">
          <div className="relative max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-500" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search users…"
              className="bg-slate-950/60 border-slate-700 text-slate-100 pl-9 h-8 text-sm"
            />
          </div>
        </div>
        <div className="p-2">
          {loading ? (
            <div className="space-y-2 p-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="h-12 rounded-lg bg-slate-800/40 animate-pulse" />
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <EmptyState icon={<Users className="h-10 w-10" />} title="No users found" />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-[11px] text-slate-500 uppercase tracking-wide border-b border-slate-800">
                    <th className="text-left font-medium px-3 py-2">User</th>
                    <th className="text-left font-medium px-3 py-2">Role</th>
                    <th className="text-left font-medium px-3 py-2">Status</th>
                    <th className="text-left font-medium px-3 py-2">2FA</th>
                    <th className="text-left font-medium px-3 py-2 hidden md:table-cell">Branch</th>
                    <th className="text-left font-medium px-3 py-2 hidden sm:table-cell">Created</th>
                    <th className="text-right font-medium px-3 py-2">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/70">
                  {filtered.map((u) => {
                    const meta = u.branch ? BRANCH_TYPE_META[u.branch.type as keyof typeof BRANCH_TYPE_META] ?? BRANCH_TYPE_META.DEPARTMENT : null;
                    const roleMeta = ROLE_META[u.role] ?? ROLE_META.USER;
                    const statusMeta = STATUS_META[u.status] ?? STATUS_META.ACTIVE;
                    const isMe = u.id === me?.id;
                    const isOwner = u.role === "OWNER";
                    const Icon = roleMeta.icon;
                    const canSuspend = !isOwner && !isMe && roleRank(me?.role) > roleRank(u.role);
                    return (
                      <tr key={u.id} className="hover:bg-slate-800/30">
                        <td className="px-3 py-2.5">
                          <div className="flex items-center gap-2">
                            <div className={cn("flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold", roleMeta.color)}>
                              {u.displayName.charAt(0).toUpperCase()}
                            </div>
                            <div className="min-w-0">
                              <div className="text-sm font-medium text-slate-200 truncate flex items-center gap-1.5">
                                {u.displayName}
                                {isMe && <span className="text-[10px] text-emerald-400">(you)</span>}
                              </div>
                              <div className="text-[11px] text-slate-500 font-mono">@{u.username}</div>
                            </div>
                          </div>
                        </td>
                        <td className="px-3 py-2.5">
                          <Badge className={cn("border", roleMeta.color)}>
                            <Icon className="h-3 w-3" />
                            {roleMeta.label}
                          </Badge>
                        </td>
                        <td className="px-3 py-2.5">
                          <Badge className={cn("border", statusMeta.color)}>
                            <span className={cn("h-1.5 w-1.5 rounded-full", statusMeta.dot)} />
                            {statusMeta.label}
                          </Badge>
                        </td>
                        <td className="px-3 py-2.5">
                          {u.twoFactorEnabled ? (
                            <TooltipProvider>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <span className="inline-flex items-center justify-center h-7 w-7 rounded-md border border-emerald-500/40 bg-emerald-500/10 text-emerald-400">
                                    <ShieldCheck className="h-3.5 w-3.5" />
                                  </span>
                                </TooltipTrigger>
                                <TooltipContent className="bg-slate-900 border-slate-700 text-slate-200">
                                  2FA enabled{u.twoFactorEnforced && " · enforced"}
                                </TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                          ) : (
                            <TooltipProvider>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <span className="inline-flex items-center justify-center h-7 w-7 rounded-md border border-slate-700 bg-slate-800/40 text-slate-500">
                                    <ShieldAlert className="h-3.5 w-3.5" />
                                  </span>
                                </TooltipTrigger>
                                <TooltipContent className="bg-slate-900 border-slate-700 text-slate-200">
                                  2FA not enabled
                                  {u.twoFactorEnforced && " · enforced (pending enrollment)"}
                                </TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                          )}
                        </td>
                        <td className="px-3 py-2.5 hidden md:table-cell">
                          {u.branch ? (
                            <div className="flex items-center gap-1.5">
                              <span className={cn("h-1.5 w-1.5 rounded-full", meta?.dot)} />
                              <span className="font-mono text-xs text-emerald-400">{u.branch.code}</span>
                              <span className="text-xs text-slate-400 truncate max-w-[120px]">{u.branch.name}</span>
                            </div>
                          ) : (
                            <span className="text-xs text-slate-600">—</span>
                          )}
                        </td>
                        <td className="px-3 py-2.5 hidden sm:table-cell">
                          <span className="text-[11px] text-slate-500">{formatRelativeTime(u.createdAt)}</span>
                        </td>
                        <td className="px-3 py-2.5">
                          <div className="flex items-center justify-end gap-1">
                            {/* Suspend / Reactivate */}
                            {canSuspend && (
                              u.status === "ACTIVE" ? (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => setSuspendTarget(u)}
                                  className="text-amber-400 hover:text-amber-300 hover:bg-amber-500/10 h-8 w-8 p-0"
                                  title="Suspend user"
                                >
                                  <Ban className="h-4 w-4" />
                                </Button>
                              ) : u.status === "SUSPENDED" ? (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={async () => {
                                    try {
                                      await api.suspendUser(u.id, false);
                                      toast({ title: "User reactivated", description: `${u.username} may now sign in again.` });
                                      await load();
                                    } catch (e) {
                                      toast({ title: "Failed to reactivate", description: e instanceof Error ? e.message : "Error", variant: "destructive" });
                                    }
                                  }}
                                  className="text-emerald-400 hover:text-emerald-300 hover:bg-emerald-500/10 h-8 w-8 p-0"
                                  title="Reactivate user"
                                >
                                  <PlayCircle className="h-4 w-4" />
                                </Button>
                              ) : null
                            )}
                            {/* Reset password */}
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => setPwTarget(u)}
                              disabled={isOwner}
                              className="text-amber-400 hover:text-amber-300 hover:bg-amber-500/10 h-8 w-8 p-0 disabled:opacity-30"
                              title={isOwner ? "Owner manages their own password" : "Reset password"}
                            >
                              <KeyRound className="h-4 w-4" />
                            </Button>
                            {/* Delete */}
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => setDeleteTarget(u)}
                              disabled={isMe || isOwner}
                              className="text-rose-400 hover:text-rose-300 hover:bg-rose-500/10 h-8 w-8 p-0 disabled:opacity-30"
                              title={isMe ? "You cannot delete yourself" : isOwner ? "Owner accounts cannot be deleted" : "Delete user"}
                            >
                              <Trash2 className="h-4 w-4" />
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

      <AddUserDialog open={addOpen} onOpenChange={setAddOpen} branches={branches} onCreated={load} toast={toast} />
      <DeleteUserDialog target={deleteTarget} onClose={() => setDeleteTarget(null)} onDone={load} toast={toast} meId={me?.id} />
      <ResetPasswordDialog target={pwTarget} onClose={() => setPwTarget(null)} toast={toast} />
      <SuspendUserDialog target={suspendTarget} onClose={() => setSuspendTarget(null)} onDone={load} toast={toast} />
    </div>
  );
}

function AddUserDialog({
  open,
  onOpenChange,
  branches,
  onCreated,
  toast,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  branches: BranchLite[];
  onCreated: () => void;
  toast: ReturnType<typeof useToast>["toast"];
}) {
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<Role>("USER");
  const [branchId, setBranchId] = useState("");
  const [saving, setSaving] = useState(false);

  const reset = () => {
    setUsername(""); setDisplayName(""); setPassword(""); setRole("USER"); setBranchId("");
  };

  const branchRequired = role === "BRANCH_ADMIN" || role === "USER" || role === "READONLY";

  const handleSave = async () => {
    if (!username || !password) {
      toast({ title: "Missing fields", description: "Username and password are required.", variant: "destructive" });
      return;
    }
    if (role === "OWNER") {
      toast({ title: "Cannot create owner", description: "The Owner role cannot be created.", variant: "destructive" });
      return;
    }
    if (branchRequired && !branchId) {
      toast({ title: "Branch required", description: `${ROLE_META[role].label} accounts must be assigned to a branch.`, variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const res = await api.createUserRaw({ username, displayName, password, role, branchId: branchRequired ? branchId : null });
      if (!res.ok) {
        throw new Error(res.error || "Failed to create user");
      }
      toast({
        title: "User created",
        description: `${username} can now sign in as ${ROLE_META[role].label}.`,
      });
      reset();
      onOpenChange(false);
      await onCreated();
    } catch (e) {
      toast({ title: "Failed to create user", description: e instanceof Error ? e.message : "Error", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) reset(); }}>
      <DialogContent className="bg-slate-900 border-slate-700 text-slate-100 max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-slate-100">
            <UserPlus className="h-5 w-5 text-emerald-400" /> Create User Account
          </DialogTitle>
          <DialogDescription className="text-slate-400">
            Provision a new login. Owner is excluded — there can only be one.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-slate-300 text-xs">Username</Label>
              <Input value={username} onChange={(e) => setUsername(e.target.value.toLowerCase())} placeholder="dept-x1" className="bg-slate-950/60 border-slate-700 text-slate-100 font-mono" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-slate-300 text-xs">Display name</Label>
              <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Department X1" className="bg-slate-950/60 border-slate-700 text-slate-100" />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-slate-300 text-xs">Initial password</Label>
            <Input value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" className="bg-slate-950/60 border-slate-700 text-slate-100" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-slate-300 text-xs">Role</Label>
              <Select value={role} onValueChange={(v) => setRole(v as Role)}>
                <SelectTrigger className="bg-slate-950/60 border-slate-700 text-slate-100"><SelectValue /></SelectTrigger>
                <SelectContent className="bg-slate-900 border-slate-700">
                  {ALL_ROLES.map((r) => {
                    const m = ROLE_META[r];
                    const Icon = m.icon;
                    return (
                      <SelectItem
                        key={r}
                        value={r}
                        disabled={r === "OWNER"}
                        className="text-slate-100 focus:bg-slate-800 data-[disabled]:opacity-50 data-[disabled]:pointer-events-none"
                      >
                        <span className="inline-flex items-center gap-2">
                          <Icon className="h-3 w-3" />
                          {m.label}
                          {r === "OWNER" && <span className="text-[10px] text-slate-500">(cannot create)</span>}
                        </span>
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
              {role === "OWNER" && (
                <p className="text-[10px] text-amber-400">Owner role cannot be created.</p>
              )}
            </div>
            {branchRequired && (
              <div className="space-y-1.5">
                <Label className="text-slate-300 text-xs">Branch</Label>
                <Select value={branchId} onValueChange={setBranchId}>
                  <SelectTrigger className="bg-slate-950/60 border-slate-700 text-slate-100"><SelectValue placeholder="Select branch" /></SelectTrigger>
                  <SelectContent className="bg-slate-900 border-slate-700 max-h-72">
                    {branches.map((b) => (
                      <SelectItem key={b.id} value={b.id} className="text-slate-100 focus:bg-slate-800">
                        <span className="font-mono text-xs text-emerald-400 mr-2">{b.code}</span>{b.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} className="text-slate-300 hover:bg-slate-800">Cancel</Button>
          <Button onClick={handleSave} disabled={saving} className="bg-emerald-600 hover:bg-emerald-500 text-white">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
            Create Account
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DeleteUserDialog({
  target,
  onClose,
  onDone,
  toast,
  meId,
}: {
  target: ManagedUser | null;
  onClose: () => void;
  onDone: () => void;
  toast: ReturnType<typeof useToast>["toast"];
  meId?: string;
}) {
  const [busy, setBusy] = useState(false);
  const handleDelete = async () => {
    if (!target) return;
    setBusy(true);
    try {
      const res = await api.deleteUserRaw(target.id);
      if (!res.ok) throw new Error(res.error || "Failed to delete");
      toast({ title: "User deleted", description: `${target.username} has been removed.` });
      onClose();
      await onDone();
    } catch (e) {
      toast({ title: "Failed to delete user", description: e instanceof Error ? e.message : "Error", variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };
  return (
    <AlertDialog open={!!target} onOpenChange={(o) => !o && onClose()}>
      <AlertDialogContent className="bg-slate-900 border-slate-700 text-slate-100">
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <Trash2 className="h-5 w-5 text-rose-400" /> Delete user account?
          </AlertDialogTitle>
          <AlertDialogDescription className="text-slate-400">
            {target && (
              <>
                This will permanently delete <span className="font-mono text-emerald-400">@{target.username}</span> ({target.displayName}). They will immediately lose access. This cannot be undone.
              </>
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel className="bg-slate-800 border-slate-700 text-slate-200 hover:bg-slate-700">Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={handleDelete} disabled={busy} className="bg-rose-600 hover:bg-rose-500 text-white">
            {busy ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Trash2 className="h-4 w-4 mr-1" />}
            Delete Account
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function ResetPasswordDialog({
  target,
  onClose,
  toast,
}: {
  target: ManagedUser | null;
  onClose: () => void;
  toast: ReturnType<typeof useToast>["toast"];
}) {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const handleReset = async () => {
    if (!target || !password) return;
    setBusy(true);
    try {
      const res = await api.resetPasswordRaw(target.id, password);
      if (!res.ok) throw new Error(res.error || "Failed to reset");
      toast({ title: "Password reset", description: `${target.username} can now sign in with the new password.` });
      setPassword("");
      onClose();
    } catch (e) {
      toast({ title: "Failed to reset password", description: e instanceof Error ? e.message : "Error", variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={!!target} onOpenChange={(o) => { if (!o) { setPassword(""); onClose(); } }}>
      <DialogContent className="bg-slate-900 border-slate-700 text-slate-100 max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-slate-100">
            <KeyRound className="h-5 w-5 text-amber-400" /> Reset Password
          </DialogTitle>
          <DialogDescription className="text-slate-400">
            {target && <>Set a new password for <span className="font-mono text-emerald-400">@{target.username}</span>.</>}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5 py-2">
          <Label className="text-slate-300 text-xs">New password</Label>
          <Input value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" className="bg-slate-950/60 border-slate-700 text-slate-100" />
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} className="text-slate-300 hover:bg-slate-800">Cancel</Button>
          <Button onClick={handleReset} disabled={busy || !password} className="bg-amber-600 hover:bg-amber-500 text-white">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
            Reset Password
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SuspendUserDialog({
  target,
  onClose,
  onDone,
  toast,
}: {
  target: ManagedUser | null;
  onClose: () => void;
  onDone: () => void;
  toast: ReturnType<typeof useToast>["toast"];
}) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const handleSuspend = async () => {
    if (!target) return;
    setBusy(true);
    try {
      await api.suspendUser(target.id, true, reason || undefined);
      toast({
        title: "User suspended",
        description: `${target.username}'s sessions were revoked. They cannot sign in until reactivated.`,
        variant: "destructive",
      });
      setReason("");
      onClose();
      await onDone();
    } catch (e) {
      toast({ title: "Failed to suspend user", description: e instanceof Error ? e.message : "Error", variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={!!target} onOpenChange={(o) => { if (!o) { setReason(""); onClose(); } }}>
      <DialogContent className="bg-slate-900 border-slate-700 text-slate-100 max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-slate-100">
            <Ban className="h-5 w-5 text-amber-400" /> Suspend User
          </DialogTitle>
          <DialogDescription className="text-slate-400">
            {target && (
              <>
                <span className="font-mono text-emerald-400">@{target.username}</span> will be marked SUSPENDED
                and all their active sessions revoked. They cannot sign in until you reactivate them.
              </>
            )}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5 py-2">
          <Label className="text-slate-300 text-xs">Reason (optional)</Label>
          <Input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Pending security review"
            className="bg-slate-950/60 border-slate-700 text-slate-100"
          />
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} className="text-slate-300 hover:bg-slate-800">Cancel</Button>
          <Button onClick={handleSuspend} disabled={busy} className="bg-amber-600 hover:bg-amber-500 text-white">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Ban className="h-4 w-4" />}
            Suspend User
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
