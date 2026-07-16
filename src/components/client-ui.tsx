"use client";

import { useState } from "react";
import { useAuth, type LiveNotification } from "@/components/auth-provider";
import {
  Users,
  Wifi,
  WifiOff,
  Bell,
  X,
  Send,
  Inbox,
  Unlock,
  Network,
  LogOut,
  ShieldCheck,
  UserCircle2,
} from "lucide-react";
import { Panel, Badge } from "@/components/sections/shared";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { BRANCH_TYPE_META, formatRelativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";

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

  return (
    <div className="flex items-center gap-2">
      <div className="flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-900/60 px-2.5 py-1.5">
        <UserCircle2 className={cn("h-4 w-4", user.role === "ADMIN" ? "text-amber-400" : "text-emerald-400")} />
        <div className="min-w-0 leading-tight">
          <div className="text-xs font-medium text-slate-100 truncate max-w-[120px]">{user.displayName}</div>
          <div className="text-[10px] text-slate-500 font-mono">
            {user.role === "ADMIN" ? "admin" : user.branch?.code}
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

/** Notifications bell with a popover of recent live events. */
export function NotificationsBell() {
  const { notifications, clearNotifications, dismissNotification, user } = useAuth();
  const [open, setOpen] = useState(false);

  // Only show the bell to branch users (admins observe but don't get per-branch delivery events).
  if (!user || user.role !== "USER") return null;
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

  if (!user || user.role !== "USER" || !user.branch) {
    return (
      <Panel className="p-4">
        <div className="flex items-center gap-2 mb-2">
          <Users className="h-4 w-4 text-slate-500" />
          <span className="text-sm font-semibold text-slate-200">Connected Clients</span>
        </div>
        <p className="text-xs text-slate-500">
          {user?.role === "ADMIN"
            ? "Admins observe the network. Sign in as a department user to join as a connected client."
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
