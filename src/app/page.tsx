"use client";

import { useState, useCallback } from "react";
import {
  LayoutDashboard,
  FileLock2,
  Network,
  KeyRound,
  ScrollText,
  ShieldCheck,
  Menu,
  Lock,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { ClientModeProvider, useClientMode } from "@/components/client-mode";
import { IdentitySelector, NotificationsBell, ConnectedClientsPanel } from "@/components/client-ui";
import { DashboardSection } from "@/components/sections/dashboard";
import { DocumentsSection } from "@/components/sections/documents";
import { BranchesSection } from "@/components/sections/branches";
import { KeysSection } from "@/components/sections/keys";
import { AuditSection } from "@/components/sections/audit";

type SectionId = "dashboard" | "documents" | "branches" | "keys" | "audit";

interface NavItem {
  id: SectionId;
  label: string;
  description: string;
  icon: typeof LayoutDashboard;
}

const NAV: NavItem[] = [
  { id: "dashboard", label: "Dashboard", description: "System overview", icon: LayoutDashboard },
  { id: "documents", label: "Documents", description: "Encrypt & exchange", icon: FileLock2 },
  { id: "branches", label: "Branches", description: "Network hierarchy", icon: Network },
  { id: "keys", label: "Key Vault", description: "ECC key management", icon: KeyRound },
  { id: "audit", label: "Audit Log", description: "Immutable trail", icon: ScrollText },
];

const SECTION_TITLES: Record<SectionId, { title: string; subtitle: string }> = {
  dashboard: { title: "Security Operations Center", subtitle: "Real-time overview of the encrypted document exchange network" },
  documents: { title: "Secure Document Exchange", subtitle: "Hybrid encryption workflow — AES-256-GCM + ECDH-P521 + ECDSA-SHA512" },
  branches: { title: "Branch Network Topology", subtitle: "Hierarchical organization with mesh sub-networks" },
  keys: { title: "Cryptographic Key Vault", subtitle: "ECC P-521 key lifecycle management" },
  audit: { title: "Immutable Audit Trail", subtitle: "Tamper-evident log of all cryptographic operations" },
};

export default function Home() {
  return (
    <ClientModeProvider>
      <Shell />
    </ClientModeProvider>
  );
}

function Shell() {
  const [section, setSection] = useState<SectionId>("dashboard");
  const [mobileOpen, setMobileOpen] = useState(false);
  const { identity } = useClientMode();

  const navigate = useCallback((id: SectionId) => {
    setSection(id);
    setMobileOpen(false);
  }, []);

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
        {NAV.map((item) => {
          const active = section === item.id;
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              onClick={() => navigate(item.id)}
              className={`group w-full flex items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-all ${
                active
                  ? "bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/30"
                  : "text-slate-400 hover:bg-slate-800/60 hover:text-slate-200"
              }`}
            >
              <Icon className={`h-[18px] w-[18px] shrink-0 ${active ? "text-emerald-400" : "text-slate-500 group-hover:text-slate-300"}`} />
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
        <ConnectedClientsPanel />
      </div>
    </div>
  );

  const meta = SECTION_TITLES[section];

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

              {/* Client identity selector + notifications + FIPS badge */}
              <div className="flex items-center gap-2">
                <IdentitySelector />
                <NotificationsBell />
                <div className="hidden lg:flex items-center gap-2 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5">
                  <ShieldCheck className="h-4 w-4 text-emerald-400" />
                  <span className="text-xs font-medium text-emerald-300">FIPS 140-2 L3</span>
                </div>
              </div>
            </div>
          </header>

          <main className="flex-1 p-4 md:p-6">
            {section === "dashboard" && <DashboardSection onNavigate={navigate} />}
            {section === "documents" && <DocumentsSection />}
            {section === "branches" && <BranchesSection />}
            {section === "keys" && <KeysSection />}
            {section === "audit" && <AuditSection />}
          </main>

          <footer className="mt-auto border-t border-slate-800 bg-slate-900/40 px-4 md:px-6 py-3">
            <div className="flex flex-col sm:flex-row items-center justify-between gap-2 text-[11px] text-slate-500">
              <div className="flex items-center gap-2">
                <ShieldCheck className="h-3.5 w-3.5 text-emerald-500" />
                <span>Secure Multi-Branch Document Exchange System</span>
                <span className="text-slate-700">•</span>
                <span>v1.1</span>
                {identity && (
                  <>
                    <span className="text-slate-700">•</span>
                    <span className="text-emerald-400">Client: {identity.code}</span>
                  </>
                )}
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
