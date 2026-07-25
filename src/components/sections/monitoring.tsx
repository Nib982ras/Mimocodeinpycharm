"use client";

import { useEffect, useState, useCallback } from "react";
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  PieChart,
  Pie,
  Cell,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import {
  Activity,
  Shield,
  Database,
  Server,
  Cpu,
  HardDrive,
  Wifi,
  WifiOff,
  Clock,
  Users,
  FileLock2,
  KeyRound,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  TrendingUp,
  MemoryStick,
} from "lucide-react";
import { api } from "@/lib/api";
import type { MonitoringData } from "@/lib/types";
import { Panel, PanelHeader, StatCard, Badge, EmptyState } from "./shared";
import { cn } from "@/lib/utils";

const COLORS = {
  emerald: "#10b981",
  teal: "#14b8a6",
  cyan: "#06b6d4",
  amber: "#f59e0b",
  rose: "#f43f5e",
  violet: "#8b5cf6",
  blue: "#3b82f6",
  slate: "#64748b",
};

const PIE_COLORS = [COLORS.emerald, COLORS.teal, COLORS.cyan, COLORS.amber, COLORS.rose, COLORS.violet];

function formatHour(h: string): string {
  const d = new Date(h + ":00:00Z");
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export function MonitoringSection() {
  const [data, setData] = useState<MonitoringData | null>(null);
  const [loading, setLoading] = useState(true);
  const [autoRefresh, setAutoRefresh] = useState(true);

  const load = useCallback(async () => {
    try {
      const d = await api.monitoring();
      if (d.ok) setData(d);
    } catch {
      /* 401 handled centrally */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    if (!autoRefresh) return;
    const t = setInterval(load, 30000); // refresh every 30s
    return () => clearInterval(t);
  }, [load, autoRefresh]);

  if (loading || !data) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="h-28 rounded-xl bg-slate-900/60 border border-slate-800 animate-pulse" />
        ))}
      </div>
    );
  }

  const { entities, timeSeries, breakdowns, health, securityEvents } = data;

  return (
    <div className="space-y-5">
      {/* Controls */}
      <div className="flex items-center justify-between">
        <div className="text-xs text-slate-500">
          Last updated: {new Date(data.timestamp).toLocaleTimeString()}
        </div>
        <button
          onClick={() => setAutoRefresh(!autoRefresh)}
          className={cn(
            "text-xs px-3 py-1.5 rounded-full border transition-colors",
            autoRefresh
              ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
              : "border-slate-700 bg-slate-800/60 text-slate-400"
          )}
        >
          {autoRefresh ? "Auto-refresh ON" : "Auto-refresh OFF"}
        </button>
      </div>

      {/* Entity stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
        <StatCard label="Active Users" value={entities.activeUsers} sub={`${entities.suspendedUsers} suspended`} icon={<Users className="h-5 w-5" />} accent="emerald" />
        <StatCard label="Documents" value={entities.documents} sub={`${entities.activeKeys} active keys`} icon={<FileLock2 className="h-5 w-5" />} accent="teal" />
        <StatCard label="Audit Events" value={entities.auditEvents} sub="immutable log" icon={<Activity className="h-5 w-5" />} accent="cyan" />
        <StatCard label="Active Sessions" value={entities.activeSessions} sub={`${entities.devices} devices`} icon={<KeyRound className="h-5 w-5" />} accent="amber" />
      </div>

      {/* Time series charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Documents per hour */}
        <Panel>
          <PanelHeader title="Documents (24h)" subtitle="Uploads per hour" icon={<TrendingUp className="h-4 w-4" />} />
          <div className="p-4 h-64">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={timeSeries.documentsPerHour}>
                <defs>
                  <linearGradient id="docGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={COLORS.emerald} stopOpacity={0.3} />
                    <stop offset="95%" stopColor={COLORS.emerald} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                <XAxis dataKey="hour" tickFormatter={formatHour} tick={{ fontSize: 10, fill: "#64748b" }} />
                <YAxis tick={{ fontSize: 10, fill: "#64748b" }} allowDecimals={false} />
                <Tooltip
                  contentStyle={{ backgroundColor: "#1e293b", border: "1px solid #334155", borderRadius: 8, fontSize: 12 }}
                  labelFormatter={formatHour}
                />
                <Area type="monotone" dataKey="count" stroke={COLORS.emerald} fill="url(#docGrad)" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Panel>

        {/* Auth attempts */}
        <Panel>
          <PanelHeader title="Auth Attempts (24h)" subtitle="Success vs failure" icon={<Shield className="h-4 w-4" />} />
          <div className="p-4 h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={timeSeries.authAttempts}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                <XAxis dataKey="hour" tickFormatter={formatHour} tick={{ fontSize: 10, fill: "#64748b" }} />
                <YAxis tick={{ fontSize: 10, fill: "#64748b" }} allowDecimals={false} />
                <Tooltip
                  contentStyle={{ backgroundColor: "#1e293b", border: "1px solid #334155", borderRadius: 8, fontSize: 12 }}
                  labelFormatter={formatHour}
                />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="success" name="Success" fill={COLORS.emerald} radius={[2, 2, 0, 0]} />
                <Bar dataKey="failure" name="Failure" fill={COLORS.rose} radius={[2, 2, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Panel>
      </div>

      {/* Breakdowns row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Users by role */}
        <Panel>
          <PanelHeader title="Users by Role" icon={<Users className="h-4 w-4" />} />
          <div className="p-4 h-56">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={breakdowns.usersByRole}
                  dataKey="count"
                  nameKey="role"
                  cx="50%"
                  cy="50%"
                  innerRadius={40}
                  outerRadius={70}
                  paddingAngle={2}
                  label={({ role, count }) => `${role}: ${count}`}
                >
                  {breakdowns.usersByRole.map((_, i) => (
                    <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip contentStyle={{ backgroundColor: "#1e293b", border: "1px solid #334155", borderRadius: 8, fontSize: 12 }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </Panel>

        {/* Documents by status */}
        <Panel>
          <PanelHeader title="Documents by Status" icon={<FileLock2 className="h-4 w-4" />} />
          <div className="p-4 h-56">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={breakdowns.documentsByStatus}
                  dataKey="count"
                  nameKey="status"
                  cx="50%"
                  cy="50%"
                  innerRadius={40}
                  outerRadius={70}
                  paddingAngle={2}
                  label={({ status, count }) => `${status}: ${count}`}
                >
                  {breakdowns.documentsByStatus.map((_, i) => (
                    <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip contentStyle={{ backgroundColor: "#1e293b", border: "1px solid #334155", borderRadius: 8, fontSize: 12 }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </Panel>

        {/* Top branches by documents */}
        <Panel>
          <PanelHeader title="Top Branches" subtitle="By document count" icon={<Activity className="h-4 w-4" />} />
          <div className="p-4 h-56">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={breakdowns.documentsByBranch} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                <XAxis type="number" tick={{ fontSize: 10, fill: "#64748b" }} allowDecimals={false} />
                <YAxis type="category" dataKey="code" tick={{ fontSize: 10, fill: "#64748b" }} width={50} />
                <Tooltip contentStyle={{ backgroundColor: "#1e293b", border: "1px solid #334155", borderRadius: 8, fontSize: 12 }} />
                <Bar dataKey="count" fill={COLORS.teal} radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Panel>
      </div>

      {/* System health */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
        <Panel className="p-4">
          <div className="flex items-center gap-3">
            <div className={cn("flex h-10 w-10 items-center justify-center rounded-lg", health.redis ? "bg-emerald-500/15 text-emerald-400" : "bg-rose-500/15 text-rose-400")}>
              {health.redis ? <Wifi className="h-5 w-5" /> : <WifiOff className="h-5 w-5" />}
            </div>
            <div>
              <div className="text-xs text-slate-400">Redis</div>
              <div className={cn("text-sm font-medium", health.redis ? "text-emerald-300" : "text-rose-300")}>
                {health.redis ? "Connected" : "Unavailable"}
              </div>
            </div>
          </div>
        </Panel>
        <Panel className="p-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-cyan-500/15 text-cyan-400">
              <Clock className="h-5 w-5" />
            </div>
            <div>
              <div className="text-xs text-slate-400">Uptime</div>
              <div className="text-sm font-medium text-cyan-300">{formatUptime(health.uptime)}</div>
            </div>
          </div>
        </Panel>
        <Panel className="p-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-violet-500/15 text-violet-400">
              <MemoryStick className="h-5 w-5" />
            </div>
            <div>
              <div className="text-xs text-slate-400">Heap Used</div>
              <div className="text-sm font-medium text-violet-300">{health.memoryMB.heapUsed} MB</div>
            </div>
          </div>
        </Panel>
        <Panel className="p-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-500/15 text-amber-400">
              <Database className="h-5 w-5" />
            </div>
            <div>
              <div className="text-xs text-slate-400">DB Latency</div>
              <div className="text-sm font-medium text-amber-300">{health.dbQueryAvgMs}ms avg</div>
            </div>
          </div>
        </Panel>
      </div>

      {/* Cache stats */}
      <Panel>
        <PanelHeader title="Cache Performance" subtitle="Hit rates across all caches" icon={<Server className="h-4 w-4" />} />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-px bg-slate-800">
          {Object.entries(health.cache).map(([name, stats]) => (
            <div key={name} className="bg-slate-900/60 p-4">
              <div className="text-[10px] text-slate-500 uppercase tracking-wide mb-2">{name}</div>
              <div className="text-lg font-bold text-slate-100 tabular-nums">{Math.round(stats.hitRate * 100)}%</div>
              <div className="text-[11px] text-slate-500 mt-0.5">{stats.hits} hits / {stats.misses} misses</div>
              <div className="mt-2 h-1.5 bg-slate-800 rounded-full overflow-hidden">
                <div
                  className="h-full bg-emerald-500 rounded-full transition-all"
                  style={{ width: `${Math.round(stats.hitRate * 100)}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      </Panel>

      {/* Security events */}
      <Panel>
        <PanelHeader
          title="Security Events (24h)"
          subtitle="Failed logins, lockdowns, key destructions"
          icon={<AlertTriangle className="h-4 w-4" />}
        />
        <div className="p-2">
          {securityEvents.length === 0 ? (
            <EmptyState icon={<CheckCircle2 className="h-8 w-8 text-emerald-400" />} title="No security events" description="All clear in the last 24 hours." />
          ) : (
            <div className="space-y-1 max-h-64 overflow-y-auto pr-1">
              {securityEvents.map((e) => (
                <div key={e.id} className="flex items-start gap-3 px-2 py-2 rounded-md hover:bg-slate-800/40">
                  <div className="mt-1.5">
                    {e.action === "LOCKDOWN" ? (
                      <AlertTriangle className="h-3.5 w-3.5 text-rose-400" />
                    ) : e.status === "FAILURE" ? (
                      <XCircle className="h-3.5 w-3.5 text-amber-400" />
                    ) : (
                      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-medium text-slate-200">{e.action}</span>
                      <span className="text-[11px] text-slate-500 font-mono">{e.actor}</span>
                      {e.ipAddress && (
                        <Badge className="border-slate-700 bg-slate-800/60 text-slate-400">{e.ipAddress}</Badge>
                      )}
                    </div>
                    <div className="text-[11px] text-slate-500">
                      {new Date(e.createdAt).toLocaleTimeString()}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </Panel>
    </div>
  );
}
