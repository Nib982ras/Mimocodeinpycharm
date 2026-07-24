"use client";

import { useState } from "react";
import { useAuth, type LiveNotification } from "@/components/auth-provider";
import {
  Users,
  Bell,
  X,
  Send,
  Inbox,
  Unlock,
  Network,
  LogOut,
  ShieldCheck,
  UserCircle2,
  Crown,
  UserCog,
  Eye,
} from "lucide-react";
import { Panel, Badge } from "@/components/sections/shared";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { BRANCH_TYPE_META, formatRelativeTime } from "@/lib/format";
import { hasMinRole, type Role } from "@/lib/types";
import { cn } from "@/lib/utils";

const ROLE_BADGE_META: Record<Role, { label: string; className: string; icon: typeof Crown }> = {
  OWNER: { label: "Owner", className: "border-amber-500/40 bg-amber-500/10 text-amber-300", icon: Crown },
  SECURITY_ADMIN: { label: "Sec Admin", className: "border-rose-500/40 bg-rose-500/10 text-rose-300", icon: ShieldCheck },
  BRANCH_ADMIN: { label: "Branch Admin", className: "border-violet-500/40 bg-violet-500/10 text-violet-300", icon: UserCog },
  USER: { label: "User", className: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300", icon: Users },
  READONLY: { label: "Read-only", className: "border-slate-600 bg-slate-700/30 text-slate-300", icon: Eye },
};

/** Header widget showing the signed-in user + logout. */
export function UserMenu() {
  const { user, logout } = useAuth();
  const [busy, setBusy] = useState(false);
  if (!user) return null;

  const handleLogout = async () => {
    setBusy(true);
    await logout();
    setBusy(false);
  };

  const roleMeta = user.role ? ROLE_BADGE_META[user.role as Role] : null;
  const Icon = roleMeta?.icon ?? UserCircle2;

  return (
    <div className="flex items-center gap-2">
      <div className="flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-900/60 px-2.5 py-1.5">
        <Icon className={cn("h-4 w-4", roleMeta?.className ? "text-current" : "text-emerald-400", roleBadgeColor(user.role))} />
        <div className="min-w-0 leading-tight">
          <div className="text-xs font-medium text-slate-100 truncate max-w-[120px]">{user.displayName}</div>
          <div className="text-[10px] text-slate-500 font-mono">
            {user.branch?.code ?? roleMeta?.label.toLowerCase().replace(/\s/g, "-")}
          </div>
        </div>
      </div>
      <Button
        variant="ghost"
        size="sm"
        onClick={handleLogout}
        disabled={busy}
        className="text-slate-400 hover:text-rose-300 hover:bg-rose-500/10 h-8 px-2"
        title="Sign out"
      >
        <LogOut className="h-4 w-4" />
        <span className="hidden sm:inline ml-1 text-xs">Sign out</span>
      </Button>
    </div>
  );
}

function roleBadgeColor(role: string | undefined): string {
  if (!role) return "";
  const m = ROLE_BADGE_META[role as Role];
  return m ? m.className.split(" ").filter((c) => c.startsWith("text-")).join(" ") : "";
}

/** Notifications bell with a popover of recent live events.
 *  Only branch-attached users (USER / BRANCH_ADMIN) get per-branch delivery
 *  events; everyone else has no live notifications to show. */
export function NotificationsBell() {
  const { notifications, clearNotifications, dismissNotification, user } = useAuth();
  const [open, setOpen] = useState(false);

  if (!user) return null;
  const isBranchUser = user.role === "USER" || user.role === "BRANCH_ADMIN";
  if (!isBranchUser) return null;
  const count = notifications.length;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative text-slate-300 hover:text-white hover:bg-slate-800 h-9 w-9">
          <Bell className="h-[18px] w-[18px]" />
          {count > 0 && (
            <span className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-emerald-500 px-1 text-[10px] font-bold text-white">
              {count > 9 ? "9+" : count}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0 bg-slate-900 border-slate-700" align="end">
        <div className="flex items-center justify-between border-b border-slate-800 px-3 py-2">
          <span className="text-xs font-semibold text-slate-200">Live notifications</span>
          {count > 0 && (
            <button onClick={clearNotifications} className="text-[11px] text-slate-400 hover:text-slate-200">
              Clear all
            </button>
          )}
        </div>
        <div className="max-h-80 overflow-y-auto">
          {count === 0 ? (
            <div className="py-8 text-center text-xs text-slate-500">No live events yet</div>
          ) : (
            notifications.map((n) => <NotificationRow key={n.id} n={n} onDismiss={() => dismissNotification(n.id)} />)
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function NotificationRow({ n, onDismiss }: { n: LiveNotification; onDismiss: () => void }) {
  const icon = {
    delivered: <Inbox className="h-4 w-4 text-emerald-400" />,
    sent: <Send className="h-4 w-4 text-teal-400" />,
    decrypted: <Unlock className="h-4 w-4 text-cyan-400" />,
    branch: <Network className="h-4 w-4 text-violet-400" />,
    presence: <Users className="h-4 w-4 text-slate-400" />,
  }[n.kind];

  return (
    <div className="flex items-start gap-2.5 border-b border-slate-800/60 px-3 py-2.5 hover:bg-slate-800/40">
      <div className="mt-0.5 shrink-0">{icon}</div>
      <div className="min-w-0 flex-1">
        <div className="text-xs font-medium text-slate-200">{n.title}</div>
        <div className="text-[11px] text-slate-400 mt-0.5">{n.description}</div>
        <div className="text-[10px] text-slate-600 mt-1">{formatRelativeTime(new Date(n.createdAt).toISOString())}</div>
      </div>
      <button onClick={onDismiss} className="text-slate-600 hover:text-slate-300">
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

/** Side panel listing online branch clients (presence). */
export function ConnectedClientsPanel() {
  const { onlineClients, connected, user } = useAuth();

  if (!user) return null;
  const isBranchUser = user.role === "USER" || user.role === "BRANCH_ADMIN";
  const isPrivileged = hasMinRole(user.role, "SECURITY_ADMIN");

  if (!isBranchUser || !user.branch) {
    return (
      <Panel className="p-4">
        <div className="flex items-center gap-2 mb-2">
          <Users className="h-4 w-4 text-slate-500" />
          <span className="text-sm font-semibold text-slate-200">Connected Clients</span>
        </div>
        <p className="text-xs text-slate-500">
          {isPrivileged
            ? `${ROLE_BADGE_META[user.role as Role]?.label ?? "Administrator"}s observe the network. Sign in as a department user to join as a connected client.`
            : "Sign in to connect as a branch client and see who else is online."}
        </p>
      </Panel>
    );
  }

  const identity = user.branch;

  return (
    <Panel>
      <div className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
        <div className="flex items-center gap-2">
          <Users className="h-4 w-4 text-emerald-400" />
          <span className="text-sm font-semibold text-slate-200">Connected Clients</span>
        </div>
        <Badge className={connected ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300" : "border-amber-500/40 bg-amber-500/10 text-amber-300"}>
          <span className={cn("h-1.5 w-1.5 rounded-full", connected ? "bg-emerald-400 animate-pulse" : "bg-amber-400")} />
          {onlineClients.length} online
        </Badge>
      </div>
      <div className="p-2 max-h-72 overflow-y-auto">
        {onlineClients.length === 0 ? (
          <div className="py-6 text-center text-xs text-slate-500">No other clients online</div>
        ) : (
          <div className="space-y-0.5">
            {onlineClients.map((c) => {
              const meta = BRANCH_TYPE_META[c.branchType as keyof typeof BRANCH_TYPE_META] ?? BRANCH_TYPE_META.DEPARTMENT;
              const isMe = c.branchId === identity.id;
              return (
                <div key={c.branchId} className={cn("flex items-center gap-2 rounded-md px-2 py-1.5", isMe && "bg-emerald-500/10 ring-1 ring-emerald-500/20")}>
                  <span className="relative flex h-2 w-2 shrink-0">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
                    <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
                  </span>
                  <span className={cn("h-1.5 w-1.5 rounded-full shrink-0", meta.dot)} />
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-medium text-slate-200 truncate">
                      {c.branchCode} {isMe && <span className="text-emerald-400">(you)</span>}
                    </div>
                    <div className="text-[10px] text-slate-500 truncate">{c.branchName}</div>
                  </div>
                  <span className="text-[10px] text-slate-600 shrink-0">{meta.label}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>
      {connected && (
        <div className="border-t border-slate-800 px-3 py-2 text-[11px] text-slate-500 flex items-center gap-1.5">
          <ShieldCheck className="h-3 w-3 text-emerald-400" />
          You are connected as {identity.code}
        </div>
      )}
    </Panel>
  );
}

