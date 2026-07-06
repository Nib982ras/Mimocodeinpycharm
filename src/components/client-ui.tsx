"use client";

import { useEffect, useState, useRef } from "react";
import { useClientMode, type LiveNotification } from "@/components/client-mode";
import {
  Users,
  Wifi,
  WifiOff,
  Bell,
  X,
  CheckCircle2,
  Send,
  Inbox,
  Unlock,
  Network,
  UserCircle2,
  ChevronDown,
} from "lucide-react";
import { Panel, Badge } from "@/components/sections/shared";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { BRANCH_TYPE_META, formatRelativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";

/** Identity selector shown in the header — pick which branch this client is. */
export function IdentitySelector() {
  const { identity, setIdentity, branches, connected } = useClientMode();

  return (
    <div className="flex items-center gap-2">
      <div className="flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-900/60 px-2 py-1.5">
        <UserCircle2 className={cn("h-4 w-4", identity ? "text-emerald-400" : "text-slate-500")} />
        <Select
          value={identity?.id ?? "__none__"}
          onValueChange={(v) => {
            if (v === "__none__") {
              setIdentity(null);
              return;
            }
            const b = branches.find((x) => x.id === v);
            setIdentity(b ?? null);
          }}
        >
          <SelectTrigger className="h-7 w-[150px] sm:w-[180px] border-0 bg-transparent p-0 text-xs text-slate-200 shadow-none focus:ring-0">
            <SelectValue placeholder="Observer (no client)" />
          </SelectTrigger>
          <SelectContent className="bg-slate-900 border-slate-700 max-h-80">
            <SelectItem value="__none__" className="text-slate-400 italic focus:bg-slate-800">
              Observer (no client)
            </SelectItem>
            {branches.map((b) => (
              <SelectItem key={b.id} value={b.id} className="text-slate-100 focus:bg-slate-800">
                <span className="font-mono text-[11px] text-emerald-400 mr-2">{b.code}</span>
                <span className="truncate">{b.name}</span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {identity ? (
        <Badge className={connected ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300" : "border-amber-500/40 bg-amber-500/10 text-amber-300"}>
          {connected ? <Wifi className="h-3 w-3" /> : <WifiOff className="h-3 w-3" />}
          {connected ? "Live" : "Linking…"}
        </Badge>
      ) : null}
    </div>
  );
}

/** Notifications bell with a popover of recent live events. */
export function NotificationsBell() {
  const { notifications, clearNotifications, dismissNotification, identity } = useClientMode();
  const [open, setOpen] = useState(false);

  if (!identity) return null;
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
  const { onlineClients, connected, identity, branches } = useClientMode();

  if (!identity) {
    return (
      <Panel className="p-4">
        <div className="flex items-center gap-2 mb-2">
          <Users className="h-4 w-4 text-slate-500" />
          <span className="text-sm font-semibold text-slate-200">Connected Clients</span>
        </div>
        <p className="text-xs text-slate-500">
          Select a branch identity in the header to connect as a client and see who else is online.
        </p>
      </Panel>
    );
  }

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
      {onlineClients.length < branches.length && (
        <div className="border-t border-slate-800 px-3 py-2 text-[11px] text-slate-500">
          {branches.length - onlineClients.length} branch(es) offline · {branches.length} total in network
        </div>
      )}
    </Panel>
  );
}
