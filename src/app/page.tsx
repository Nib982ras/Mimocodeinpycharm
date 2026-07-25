"use client";

import { useState, useCallback, useEffect } from "react";
import {
  LayoutDashboard,
  FileLock2,
  Network,
  KeyRound,
  ScrollText,
  ShieldCheck,
  Menu,
  Lock,
  Users,
  Cpu,
  BadgeCheck,
  Server,
  AlertOctagon,
  PowerOff,
  Crown,
  BarChart3,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { AuthProvider, useAuth } from "@/components/auth-provider";
import { UserMenu, NotificationsBell, ConnectedClientsPanel } from "@/components/client-ui";
import { ChatPanel } from "@/components/chat-panel";
import { LoginScreen } from "@/components/login-screen";
import { DashboardSection } from "@/components/sections/dashboard";
import { DocumentsSection } from "@/components/sections/documents";
import { BranchesSection } from "@/components/sections/branches";
import { KeysSection } from "@/components/sections/keys";
import { AuditSection } from "@/components/sections/audit";
import { UsersSection } from "@/components/sections/users";
import { DevicesSection } from "@/components/sections/devices";
import { LicensesSection } from "@/components/sections/licenses";
import { SystemSection } from "@/components/sections/system";
import { MonitoringSection } from "@/components/sections/monitoring";
import { Loader2 } from "lucide-react";
import { api } from "@/lib/api";
import { hasMinRole, type Role, type SystemState } from "@/lib/types";
import { cn } from "@/lib/utils";

type SectionId = "dashboard" | "documents" | "branches" | "keys" | "audit" | "users" | "devices" | "licenses" | "system" | "monitoring";

interface NavItem {
  id: SectionId;
  label: string;
  description: string;
  icon: typeof LayoutDashboard;
  minRole?: Role; // defaults to READONLY (visible to all)
}

const NAV: NavItem[] = [
  { id: "dashboard", label: "Dashboard", description: "System overview", icon: LayoutDashboard },
  { id: "documents", label: "Documents", description: "Encrypt & exchange", icon: FileLock2 },
  { id: "branches", label: "Branches", description: "Network hierarchy", icon: Network, minRole: "SECURITY_ADMIN" },
  { id: "keys", label: "Key Vault", description: "ECC key management", icon: KeyRound, minRole: "SECURITY_ADMIN" },
  { id: "users", label: "Users", description: "Account management", icon: Users, minRole: "SECURITY_ADMIN" },
  { id: "devices", label: "Devices", description: "Public-key devices", icon: Cpu, minRole: "SECURITY_ADMIN" },
  { id: "licenses", label: "Licenses", description: "Signed device licenses", icon: BadgeCheck, minRole: "SECURITY_ADMIN" },
  { id: "audit", label: "Audit Log", description: "Immutable trail", icon: ScrollText },
  { id: "system", label: "System", description: "Owner control panel", icon: Server, minRole: "OWNER" },
  { id: "monitoring", label: "Monitoring", description: "Real-time metrics", icon: BarChart3, minRole: "SECURITY_ADMIN" },
];

const SECTION_TITLES: Record<SectionId, { title: string; subtitle: string }> = {
  dashboard: { title: "Security Operations Center", subtitle: "Real-time overview of the encrypted document exchange network" },
  documents: { title: "Secure Document Exchange", subtitle: "Hybrid encryption workflow — AES-256-GCM + ECDH-P521 + ECDSA-SHA512" },
  branches: { title: "Branch Network Topology", subtitle: "Hierarchical organization with mesh sub-networks" },
  keys: { title: "Cryptographic Key Vault", subtitle: "ECC P-521 key lifecycle management" },
  users: { title: "User Account Management", subtitle: "Provision and manage department & administrator logins" },
  devices: { title: "Device Registry", subtitle: "Public-key-bound devices and their fingerprints" },
  licenses: { title: "Cryptographic Licenses", subtitle: "ECDSA-P521-SHA512 signed device licenses" },
  audit: { title: "Immutable Audit Trail", subtitle: "Tamper-evident log of all cryptographic operations" },
  system: { title: "Owner Control Panel", subtitle: "System activation, emergency lockdown, and key destruction" },
  monitoring: { title: "Monitoring Dashboard", subtitle: "Real-time system metrics, performance, and security events" },
};

const ROLE_HEADER_META: Record<Role, { label: string; className: string; icon: typeof Crown }> = {
  OWNER: { label: "Owner", className: "border-amber-500/40 bg-amber-500/10 text-amber-300", icon: Crown },
  SECURITY_ADMIN: { label: "Sec Admin", className: "border-rose-500/40 bg-rose-500/10 text-rose-300", icon: ShieldCheck },
  BRANCH_ADMIN: { label: "Branch Admin", className: "border-violet-500/40 bg-violet-500/10 text-violet-300", icon: Users },
  USER: { label: "User", className: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300", icon: Users },
  READONLY: { label: "Read-only", className: "border-slate-600 bg-slate-700/30 text-slate-300", icon: Users },
};

export default function Home() {
  return (
    <AuthProvider>
      <Shell />
    </AuthProvider>
  );
}

function Shell() {
  const { user, loading } = useAuth();
  const [section, setSection] = useState<SectionId>("dashboard");
  const [mobileOpen, setMobileOpen] = useState(false);
  const [sysState, setSysState] = useState<SystemState | null>(null);
  const [dmUser, setDmUser] = useState<{ id: string; displayName: string; branchCode: string } | null>(null);

  // Lightly poll the system state (every 15s) so the header badge reflects
  // lockdown / deactivated conditions without requiring the user to navigate.
  useEffect(() => {
    if (!user) return;
    let alive = true;
    const tick = async () => {
      try {
        const res = await api.systemState();
        if (alive) setSysState(res.state);
      } catch {
        /* 401 handled centrally */
      }
    };
    tick();
    const t = setInterval(tick, 15000);
    return () => { alive = false; clearInterval(t); };
  }, [user]);

  const navigate = useCallback((id: SectionId) => {
    setSection(id);
    setMobileOpen(false);
  }, []);

  // While the session is being checked, show a splash.
  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <div className="flex flex-col items-center gap-3 text-slate-400">
          <Loader2 className="h-6 w-6 animate-spin text-emerald-400" />
          <span className="text-sm">Loading secure session…</span>
        </div>
      </div>
    );
  }

  // No session → login screen.
  if (!user) {
    return <LoginScreen />;
  }

  const canSee = (item: NavItem) => hasMinRole(user.role, item.minRole ?? "READONLY");
  const visibleNav = NAV.filter(canSee);

  // Guard: if the active section is no longer visible (e.g. role changed),
  // reset to the dashboard.
  const activeItem = NAV.find((n) => n.id === section);
  const activeSection = activeItem && canSee(activeItem) ? section : "dashboard";

  const roleMeta = ROLE_HEADER_META[user.role as Role] ?? ROLE_HEADER_META.USER;
  const RoleIcon = roleMeta.icon;
  const isPrivileged = hasMinRole(user.role, "SECURITY_ADMIN");

  const sidebar = (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-3 px-5 py-5 border-b border-slate-800">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-to-br from-emerald-500 to-teal-600 shadow-lg shadow-emerald-500/20">
          <ShieldCheck className="h-6 w-6 text-white" />
        </div>
        <div className="min-w-0">
          <div className="font-semibold text-slate-100 leading-tight">SecureExchange</div>
          <div className="text-[11px] text-slate-400 leading-tight">ECC Document Vault</div>
        </div>
      </div>

      <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
        {visibleNav.map((item) => {
          const active = activeSection === item.id;
          const Icon = item.icon;
          const isOwnerOnly = item.minRole === "OWNER";
          return (
            <button
              key={item.id}
              onClick={() => navigate(item.id)}
              className={cn(
                "group w-full flex items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-all",
                active
                  ? "bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/30"
                  : "text-slate-400 hover:bg-slate-800/60 hover:text-slate-200",
                isOwnerOnly && !active && "text-amber-500/80 hover:text-amber-300"
              )}
            >
              <Icon className={cn("h-[18px] w-[18px] shrink-0", active ? "text-emerald-400" : isOwnerOnly ? "text-amber-500/80 group-hover:text-amber-300" : "text-slate-500 group-hover:text-slate-300")} />
              <div className="min-w-0">
                <div className="text-sm font-medium leading-tight">{item.label}</div>
                <div className="text-[11px] text-slate-500 leading-tight">{item.description}</div>
              </div>
            </button>
          );
        })}
      </nav>

      <div className="px-3 py-4 border-t border-slate-800 space-y-2">
        <div className="rounded-lg bg-slate-900/80 border border-slate-800 p-3">
          <div className="flex items-center gap-2 mb-2">
            <Lock className="h-3.5 w-3.5 text-emerald-400" />
            <span className="text-[11px] font-semibold text-slate-300 uppercase tracking-wide">Crypto Stack</span>
          </div>
          <div className="space-y-1 text-[11px] text-slate-400 font-mono">
            <div className="flex justify-between"><span>Curve</span><span className="text-emerald-300">P-521</span></div>
            <div className="flex justify-between"><span>Symmetric</span><span className="text-emerald-300">AES-256-GCM</span></div>
            <div className="flex justify-between"><span>Exchange</span><span className="text-emerald-300">ECDHE</span></div>
            <div className="flex justify-between"><span>Signature</span><span className="text-emerald-300">ECDSA-S512</span></div>
          </div>
        </div>
        <ConnectedClientsPanel onDmUser={setDmUser} />
        <div className="mt-4">
          <ChatPanel dmUser={dmUser} onClearDm={() => setDmUser(null)} />
        </div>
      </div>
    </div>
  );

  const meta = SECTION_TITLES[activeSection];

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col">
      <div className="flex flex-1">
        {/* Desktop sidebar */}
        <aside className="hidden md:flex w-64 shrink-0 flex-col border-r border-slate-800 bg-slate-900/40 sticky top-0 h-screen">
          {sidebar}
        </aside>

        {/* Main column */}
        <div className="flex-1 flex flex-col min-w-0 min-h-screen">
          <header className="sticky top-0 z-20 border-b border-slate-800 bg-slate-950/80 backdrop-blur supports-[backdrop-filter]:bg-slate-950/60">
            <div className="flex items-center gap-3 px-4 md:px-6 py-3.5">
              {/* Mobile menu */}
              <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
                <SheetTrigger asChild>
                  <Button variant="ghost" size="icon" className="md:hidden text-slate-300 hover:text-white hover:bg-slate-800">
                    <Menu className="h-5 w-5" />
                  </Button>
                </SheetTrigger>
                <SheetContent side="left" className="w-72 bg-slate-900 border-slate-800 p-0">
                  <SheetHeader className="sr-only">
                    <SheetTitle>Navigation</SheetTitle>
                  </SheetHeader>
                  {sidebar}
                </SheetContent>
              </Sheet>

              <div className="min-w-0 flex-1">
                <h1 className="text-lg md:text-xl font-semibold text-slate-100 leading-tight truncate">{meta.title}</h1>
                <p className="text-xs md:text-sm text-slate-400 leading-tight truncate">{meta.subtitle}</p>
              </div>

              {/* System status indicators */}
              <div className="hidden sm:flex items-center gap-1.5">
                {sysState?.lockdown && (
                  <div className="flex items-center gap-1.5 rounded-full border border-rose-500/40 bg-rose-500/10 px-2.5 py-1.5 animate-pulse">
                    <AlertOctagon className="h-3.5 w-3.5 text-rose-400" />
                    <span className="text-[11px] font-bold text-rose-300 tracking-wide">LOCKDOWN</span>
                  </div>
                )}
                {sysState && !sysState.active && (
                  <div className="flex items-center gap-1.5 rounded-full border border-amber-500/40 bg-amber-500/10 px-2.5 py-1.5">
                    <PowerOff className="h-3.5 w-3.5 text-amber-400" />
                    <span className="text-[11px] font-bold text-amber-300 tracking-wide">DEACTIVATED</span>
                  </div>
                )}
              </div>

              {/* Role badge + notifications + user menu */}
              <div className="flex items-center gap-2">
                <NotificationsBell />
                {isPrivileged && (
                  <div className={cn("hidden sm:flex items-center gap-2 rounded-full border px-3 py-1.5", roleMeta.className)}>
                    <RoleIcon className="h-4 w-4" />
                    <span className="text-xs font-medium">{roleMeta.label}</span>
                  </div>
                )}
                <UserMenu />
              </div>
            </div>
          </header>

          <main className="flex-1 p-4 md:p-6">
            {activeSection === "dashboard" && <DashboardSection onNavigate={(id) => navigate(id as SectionId)} />}
            {activeSection === "documents" && <DocumentsSection />}
            {activeSection === "branches" && <BranchesSection />}
            {activeSection === "keys" && <KeysSection />}
            {activeSection === "users" && <UsersSection />}
            {activeSection === "devices" && <DevicesSection />}
            {activeSection === "licenses" && <LicensesSection />}
            {activeSection === "audit" && <AuditSection />}
            {activeSection === "system" && <SystemSection />}
            {activeSection === "monitoring" && <MonitoringSection />}
          </main>

          <footer className="mt-auto border-t border-slate-800 bg-slate-900/40 px-4 md:px-6 py-3">
            <div className="flex flex-col sm:flex-row items-center justify-between gap-2 text-[11px] text-slate-500">
              <div className="flex items-center gap-2 flex-wrap">
                <ShieldCheck className="h-3.5 w-3.5 text-emerald-500" />
                <span>Secure Multi-Branch Document Exchange System</span>
                <span className="text-slate-700">•</span>
                <span>v2.0</span>
                <span className="text-slate-700">•</span>
                <span className="text-emerald-400">@{user.username}</span>
                <span className="text-slate-600">· {roleMeta.label}</span>
                {user.branch && <span className="text-slate-600">· {user.branch.code}</span>}
              </div>
              <div className="flex items-center gap-3 font-mono">
                <span>NIST SP 800-57</span>
                <span className="text-slate-700">|</span>
                <span>ISO/IEC 27001</span>
                <span className="text-slate-700">|</span>
                <span>SOC 2 Type II</span>
              </div>
            </div>
          </footer>
        </div>
      </div>
    </div>
  );
}
