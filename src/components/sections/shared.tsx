"use client";

import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

/** Dark-themed card wrapper used across all sections. */
export function Panel({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "rounded-xl border border-slate-800 bg-slate-900/60 backdrop-blur-sm",
        className
      )}
    >
      {children}
    </div>
  );
}

export function PanelHeader({
  title,
  subtitle,
  icon,
  action,
}: {
  title: string;
  subtitle?: string;
  icon?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-slate-800 px-4 md:px-5 py-3.5">
      <div className="flex items-start gap-2.5 min-w-0">
        {icon && <div className="mt-0.5 text-emerald-400 shrink-0">{icon}</div>}
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-slate-100 leading-tight">{title}</h3>
          {subtitle && <p className="text-xs text-slate-400 leading-tight mt-0.5">{subtitle}</p>}
        </div>
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

export function StatCard({
  label,
  value,
  sub,
  icon,
  accent = "emerald",
}: {
  label: string;
  value: string | number;
  sub?: string;
  icon?: ReactNode;
  accent?: "emerald" | "teal" | "cyan" | "amber" | "rose";
}) {
  const accents: Record<string, string> = {
    emerald: "from-emerald-500/20 to-emerald-500/5 text-emerald-300 ring-emerald-500/20",
    teal: "from-teal-500/20 to-teal-500/5 text-teal-300 ring-teal-500/20",
    cyan: "from-cyan-500/20 to-cyan-500/5 text-cyan-300 ring-cyan-500/20",
    amber: "from-amber-500/20 to-amber-500/5 text-amber-300 ring-amber-500/20",
    rose: "from-rose-500/20 to-rose-500/5 text-rose-300 ring-rose-500/20",
  };
  return (
    <Panel className="p-4 md:p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xs font-medium text-slate-400 uppercase tracking-wide">{label}</div>
          <div className="mt-1.5 text-2xl md:text-3xl font-bold text-slate-100 tabular-nums">{value}</div>
          {sub && <div className="mt-1 text-[11px] text-slate-500">{sub}</div>}
        </div>
        {icon && (
          <div className={cn("flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-to-br ring-1", accents[accent])}>
            {icon}
          </div>
        )}
      </div>
    </Panel>
  );
}

export function Badge({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium",
        className
      )}
    >
      {children}
    </span>
  );
}

export function EmptyState({
  icon,
  title,
  description,
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-10 text-center">
      {icon && <div className="mb-3 text-slate-600">{icon}</div>}
      <p className="text-sm font-medium text-slate-300">{title}</p>
      {description && <p className="mt-1 text-xs text-slate-500 max-w-sm">{description}</p>}
    </div>
  );
}
