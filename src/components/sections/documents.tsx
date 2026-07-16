"use client";

import { useEffect, useState, useCallback } from "react";
import {
  FileLock2,
  Upload,
  Download,
  ShieldCheck,
  ShieldAlert,
  Loader2,
  Lock,
  Unlock,
  Package,
  ArrowRight,
  KeyRound,
  Hash,
  Fingerprint,
  FileDown,
  CheckCircle2,
  XCircle,
  Info,
} from "lucide-react";
import { api } from "@/lib/api";
import type { Branch, DocumentRecord } from "@/lib/types";
import { formatBytes, formatDateTime, formatRelativeTime, shortHash, BRANCH_TYPE_META } from "@/lib/format";
import { Panel, PanelHeader, Badge, EmptyState } from "./shared";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/components/auth-provider";
import { cn } from "@/lib/utils";

const WORKFLOW_STEPS = [
  "Authenticate sender",
  "Generate 256-bit session key",
  "AES-256-GCM encrypt document",
  "ECDH encapsulate session key",
  "ECDSA-SHA512 sign ciphertext",
  "Assemble secure package",
  "Store & audit",
];

type DocTab = "all" | "inbox" | "outbox";

export function DocumentsSection() {
  const { user } = useAuth();
  // For branch users, the sender is their own branch (locked). Admins can pick any sender.
  const identity = user?.role === "USER" && user.branch
    ? { id: user.branch.id, code: user.branch.code, name: user.branch.name }
    : null;
  const isAdmin = user?.role === "ADMIN";
  const [branches, setBranches] = useState<Branch[]>([]);
  const [documents, setDocuments] = useState<DocumentRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();

  const [senderId, setSenderId] = useState("");
  const [recipientId, setRecipientId] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);

  const [detailDoc, setDetailDoc] = useState<DocumentRecord | null>(null);
  const [decrypting, setDecrypting] = useState<string | null>(null);
  const [verifyResult, setVerifyResult] = useState<{ name: string; signatureValid: boolean; hashValid: boolean; hash: string } | null>(null);

  // Tab defaults to "inbox" when a client identity is active.
  const [tab, setTab] = useState<DocTab>("all");
  const [reloadTick, setReloadTick] = useState(0);

  const load = useCallback(async () => {
    try {
      const [b, d] = await Promise.all([api.branches(), api.documents()]);
      setBranches(b.branches);
      setDocuments(d.documents);
    } catch {
      // A 401 triggers the auth:unauthorized event (handled by AuthProvider →
      // login screen). Any other error just keeps the previous state.
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // When identity changes, default the tab and prefill the sender.
  useEffect(() => {
    if (identity) {
      setTab("inbox");
      setSenderId(identity.id);
    } else {
      setTab("all");
      setSenderId("");
    }
  }, [identity?.id]);

  // Poll for new documents every 5s when in client mode (best-effort live refresh
  // in addition to the socket-driven reload below).
  useEffect(() => {
    if (!identity) return;
    const t = setInterval(() => setReloadTick((n) => n + 1), 5000);
    return () => clearInterval(t);
  }, [identity?.id]);
  useEffect(() => {
    if (reloadTick > 0) load();
  }, [reloadTick, load]);

  // Filter documents by the active tab + client identity.
  const filteredDocs = documents.filter((d) => {
    if (!identity || tab === "all") return true;
    if (tab === "inbox") return d.recipient.code === identity.code;
    if (tab === "outbox") return d.sender.code === identity.code;
    return true;
  });

  const handleUpload = async () => {
    if (!file || !senderId || !recipientId) {
      toast({ title: "Missing fields", description: "Select a sender, recipient, and file.", variant: "destructive" });
      return;
    }
    if (senderId === recipientId) {
      toast({ title: "Invalid exchange", description: "Sender and recipient must differ.", variant: "destructive" });
      return;
    }
    setUploading(true);
    try {
      const res = await api.uploadDocument(file, senderId, recipientId);
      toast({
        title: "Document encrypted & delivered",
        description: `${res.document.name} secured with AES-256-GCM + ECDH-P521 + ECDSA-SHA512.`,
      });
      setFile(null);
      // Keep sender locked to identity (if set); clear recipient for next dispatch.
      setRecipientId("");
      if (!identity) setSenderId("");
      await load();
    } catch (e) {
      toast({ title: "Encryption failed", description: e instanceof Error ? e.message : "Unknown error", variant: "destructive" });
    } finally {
      setUploading(false);
    }
  };

  const handleDecrypt = async (doc: DocumentRecord) => {
    setDecrypting(doc.id);
    setVerifyResult(null);
    try {
      const result = await api.decryptDocument(doc.id);
      // Trigger browser download of the decrypted file
      const url = URL.createObjectURL(result.blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = doc.name;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setVerifyResult({
        name: doc.name,
        signatureValid: result.signatureValid,
        hashValid: result.documentHashValid,
        hash: result.documentHash,
      });
      await load();
    } catch (e) {
      toast({ title: "Decryption failed", description: e instanceof Error ? e.message : "Possible tampering or key mismatch.", variant: "destructive" });
    } finally {
      setDecrypting(null);
    }
  };

  const branchOptions = branches.filter((b) => b.type !== "HEADQUARTERS" || true);

  return (
    <div className="space-y-5">
      {/* Upload / encryption card */}
      <Panel>
        <PanelHeader
          title="Encrypt & Dispatch Document"
          subtitle="Hybrid encryption workflow — each document gets a unique ephemeral key"
          icon={<Upload className="h-4 w-4" />}
        />
        <div className="p-4 md:p-5">
          <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
            <div className="md:col-span-4 space-y-1.5">
              <label className="text-xs font-medium text-slate-400">
                Sender branch {identity ? <span className="text-emerald-400">· locked to your account</span> : isAdmin && <span className="text-amber-400">· admin: choose any</span>}
              </label>
              {identity ? (
                <div className="flex items-center gap-2 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-2">
                  <Lock className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                  <span className="font-mono text-xs text-emerald-400">{identity.code}</span>
                  <span className="text-xs text-slate-300 truncate">{identity.name}</span>
                </div>
              ) : (
                <Select value={senderId} onValueChange={setSenderId}>
                  <SelectTrigger className="bg-slate-950/60 border-slate-700 text-slate-100"><SelectValue placeholder="Select sender" /></SelectTrigger>
                  <SelectContent className="bg-slate-900 border-slate-700 max-h-72">
                    {branchOptions.map((b) => (
                      <SelectItem key={b.id} value={b.id} className="text-slate-100 focus:bg-slate-800">
                        <span className="font-mono text-xs text-emerald-400 mr-2">{b.code}</span>{b.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
            <div className="md:col-span-4 space-y-1.5">
              <label className="text-xs font-medium text-slate-400">Recipient branch</label>
              <Select value={recipientId} onValueChange={setRecipientId}>
                <SelectTrigger className="bg-slate-950/60 border-slate-700 text-slate-100"><SelectValue placeholder="Select recipient" /></SelectTrigger>
                <SelectContent className="bg-slate-900 border-slate-700 max-h-72">
                  {branchOptions.filter((b) => b.id !== senderId).map((b) => (
                    <SelectItem key={b.id} value={b.id} className="text-slate-100 focus:bg-slate-800">
                      <span className="font-mono text-xs text-emerald-400 mr-2">{b.code}</span>{b.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="md:col-span-4 space-y-1.5">
              <label className="text-xs font-medium text-slate-400">Document file</label>
              <label className="flex items-center gap-2 cursor-pointer rounded-md border border-slate-700 bg-slate-950/60 px-3 py-2 hover:border-emerald-500/50 transition-colors">
                <FileLock2 className="h-4 w-4 text-slate-400 shrink-0" />
                <span className={cn("text-sm truncate flex-1", file ? "text-slate-200" : "text-slate-500")}>
                  {file ? file.name : "Choose file…"}
                </span>
                <input
                  type="file"
                  className="hidden"
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                />
              </label>
            </div>
          </div>

          <div className="mt-4 flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
            <Button
              onClick={handleUpload}
              disabled={uploading || !file || !senderId || !recipientId}
              className="bg-emerald-600 hover:bg-emerald-500 text-white"
            >
              {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Lock className="h-4 w-4" />}
              {uploading ? "Encrypting…" : "Encrypt & Send"}
            </Button>
            {file && (
              <span className="text-xs text-slate-500">
                {formatBytes(file.size)} · will be encrypted with a fresh session key
              </span>
            )}
          </div>

          {/* Workflow steps */}
          <div className="mt-5 pt-4 border-t border-slate-800">
            <div className="flex items-center gap-2 mb-3">
              <Info className="h-3.5 w-3.5 text-slate-500" />
              <span className="text-[11px] font-medium text-slate-400 uppercase tracking-wide">7-step encryption workflow</span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {WORKFLOW_STEPS.map((step, i) => (
                <div key={step} className="flex items-center gap-1.5">
                  <span className="inline-flex items-center gap-1.5 rounded-md border border-slate-700 bg-slate-800/40 px-2 py-1 text-[11px] text-slate-300">
                    <span className="font-mono text-emerald-400">{i + 1}</span>
                    {step}
                  </span>
                  {i < WORKFLOW_STEPS.length - 1 && <ArrowRight className="h-3 w-3 text-slate-600 hidden sm:block" />}
                </div>
              ))}
            </div>
          </div>
        </div>
      </Panel>

      {/* Verification result toast card */}
      {verifyResult && (
        <Panel className={cn("border", verifyResult.signatureValid && verifyResult.hashValid ? "border-emerald-500/40" : "border-amber-500/40")}>
          <div className="p-4 flex items-start gap-3">
            {verifyResult.signatureValid && verifyResult.hashValid ? (
              <CheckCircle2 className="h-5 w-5 text-emerald-400 shrink-0 mt-0.5" />
            ) : (
              <XCircle className="h-5 w-5 text-amber-400 shrink-0 mt-0.5" />
            )}
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium text-slate-100">Decryption complete — verification report</div>
              <div className="mt-1 text-xs text-slate-400">{verifyResult.name}</div>
              <div className="mt-2 flex flex-wrap gap-2">
                <Badge className={verifyResult.signatureValid ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300" : "border-rose-500/40 bg-rose-500/10 text-rose-300"}>
                  <ShieldCheck className="h-3 w-3" /> Signature {verifyResult.signatureValid ? "valid" : "INVALID"}
                </Badge>
                <Badge className={verifyResult.hashValid ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300" : "border-rose-500/40 bg-rose-500/10 text-rose-300"}>
                  <Hash className="h-3 w-3" /> Integrity {verifyResult.hashValid ? "verified" : "FAILED"}
                </Badge>
              </div>
              <div className="mt-2 text-[11px] font-mono text-slate-500 break-all">SHA-512: {shortHash(verifyResult.hash, 20, 16)}</div>
            </div>
            <button onClick={() => setVerifyResult(null)} className="text-slate-500 hover:text-slate-300 text-xs">Dismiss</button>
          </div>
        </Panel>
      )}

      {/* Documents list */}
      <Panel>
        <PanelHeader
          title="Secure Packages"
          subtitle={`${filteredDocs.length} encrypted document${filteredDocs.length === 1 ? "" : "s"}${identity ? ` · ${tab === "inbox" ? "your inbox" : tab === "outbox" ? "your outbox" : "vault"}` : " in vault"}`}
          icon={<Package className="h-4 w-4" />}
          action={
            identity ? (
              <Tabs value={tab} onValueChange={(v) => setTab(v as DocTab)}>
                <TabsList className="bg-slate-800/60 border border-slate-700 h-8">
                  <TabsTrigger value="inbox" className="text-xs data-[state=active]:bg-emerald-500/20 data-[state=active]:text-emerald-300">Inbox</TabsTrigger>
                  <TabsTrigger value="outbox" className="text-xs data-[state=active]:bg-emerald-500/20 data-[state=active]:text-emerald-300">Outbox</TabsTrigger>
                  <TabsTrigger value="all" className="text-xs data-[state=active]:bg-emerald-500/20 data-[state=active]:text-emerald-300">All</TabsTrigger>
                </TabsList>
              </Tabs>
            ) : undefined
          }
        />
        <div className="p-2">
          {loading ? (
            <div className="space-y-2 p-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="h-14 rounded-lg bg-slate-800/40 animate-pulse" />
              ))}
            </div>
          ) : filteredDocs.length === 0 ? (
            <EmptyState
              icon={<FileLock2 className="h-10 w-10" />}
              title={identity && tab === "inbox" ? "Your inbox is empty" : identity && tab === "outbox" ? "You haven't sent any documents" : "No encrypted documents yet"}
              description={identity && tab === "inbox" ? "Encrypted documents sent to your branch will appear here in real time." : "Use the form above to encrypt and dispatch a secure document between branches."}
            />
          ) : (
            <div className="divide-y divide-slate-800/70">
              {filteredDocs.map((d) => {
                const isMineIn = identity && d.recipient.code === identity.code;
                const isMineOut = identity && d.sender.code === identity.code;
                return (
                <div key={d.id} className="flex items-center gap-3 px-2 py-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-slate-800 border border-slate-700">
                    {d.status === "DECRYPTED" ? <Unlock className="h-4 w-4 text-emerald-400" /> : <Lock className="h-4 w-4 text-amber-400" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium text-slate-200 truncate flex items-center gap-2">
                      {d.name}
                      {isMineIn && <Badge className="border-emerald-500/30 bg-emerald-500/10 text-emerald-300">to you</Badge>}
                      {isMineOut && <Badge className="border-teal-500/30 bg-teal-500/10 text-teal-300">from you</Badge>}
                    </div>
                    <div className="text-[11px] text-slate-500 font-mono flex items-center gap-1.5 flex-wrap">
                      <span className="text-emerald-400">{d.sender.code}</span>
                      <ArrowRight className="h-3 w-3" />
                      <span className="text-teal-400">{d.recipient.code}</span>
                      <span>·</span>
                      <span>{formatBytes(d.originalSize)}</span>
                      <span>·</span>
                      <span>{formatRelativeTime(d.createdAt)}</span>
                    </div>
                  </div>
                  <Badge className={d.status === "DECRYPTED" ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300" : "border-amber-500/40 bg-amber-500/10 text-amber-300"}>
                    {d.status}
                  </Badge>
                  <div className="flex items-center gap-1">
                    <Button variant="ghost" size="sm" onClick={() => setDetailDoc(d)} className="text-slate-400 hover:text-slate-100 hover:bg-slate-800">
                      <Package className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleDecrypt(d)}
                      disabled={decrypting === d.id}
                      className="text-emerald-400 hover:text-emerald-300 hover:bg-emerald-500/10"
                    >
                      {decrypting === d.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileDown className="h-4 w-4" />}
                    </Button>
                  </div>
                </div>
                );
              })}
            </div>
          )}
        </div>
      </Panel>

      {/* Package detail dialog */}
      <PackageDetailDialog doc={detailDoc} onClose={() => setDetailDoc(null)} />
    </div>
  );
}

function PackageDetailDialog({ doc, onClose }: { doc: DocumentRecord | null; onClose: () => void }) {
  return (
    <Dialog open={!!doc} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="bg-slate-900 border-slate-700 text-slate-100 max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-slate-100">
            <Package className="h-5 w-5 text-emerald-400" /> Secure Package — {doc?.name}
          </DialogTitle>
          <DialogDescription className="text-slate-400">
            Cryptographic metadata for this encrypted document exchange
          </DialogDescription>
        </DialogHeader>
        {doc && (
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Package version" value={doc.packageVersion} mono />
              <Field label="Status" value={doc.status} />
              <Field label="Original size" value={formatBytes(doc.originalSize)} />
              <Field label="MIME type" value={doc.mimeType} mono />
              <Field label="Created" value={formatDateTime(doc.createdAt)} />
              <Field label="Decrypted" value={doc.decryptedAt ? formatDateTime(doc.decryptedAt) : "—"} />
            </div>

            <div className="rounded-lg border border-slate-800 bg-slate-950/50 p-3 space-y-2">
              <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide flex items-center gap-1.5">
                <ArrowRight className="h-3 w-3" /> Exchange route
              </div>
              <div className="flex items-center gap-2 text-sm">
                <BranchChip code={doc.sender.code} name={doc.sender.name} />
                <ArrowRight className="h-4 w-4 text-slate-500" />
                <BranchChip code={doc.recipient.code} name={doc.recipient.name} />
              </div>
            </div>

            <div className="rounded-lg border border-slate-800 bg-slate-950/50 p-3 space-y-2">
              <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide flex items-center gap-1.5">
                <KeyRound className="h-3 w-3" /> Cryptographic keys used
              </div>
              {doc.senderKey && (
                <KeyLine label="Sender signing key" purpose={doc.senderKey.purpose} version={doc.senderKey.version} fp={doc.senderKey.fingerprint} />
              )}
              {doc.recipientKey && (
                <KeyLine label="Recipient encryption key" purpose={doc.recipientKey.purpose} version={doc.recipientKey.version} fp={doc.recipientKey.fingerprint} />
              )}
            </div>

            <div className="rounded-lg border border-slate-800 bg-slate-950/50 p-3 space-y-2">
              <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide flex items-center gap-1.5">
                <Fingerprint className="h-3 w-3" /> Integrity & replay protection
              </div>
              <Field label="Nonce (128-bit)" value={doc.nonce} mono small />
              <Field label="Document hash (SHA-512)" value={doc.documentHash} mono small />
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, value, mono, small }: { label: string; value: string; mono?: boolean; small?: boolean }) {
  return (
    <div className="min-w-0">
      <div className="text-[10px] font-medium text-slate-500 uppercase tracking-wide">{label}</div>
      <div className={cn("text-slate-200 truncate", mono && "font-mono", small ? "text-[11px]" : "text-sm")} title={value}>
        {value}
      </div>
    </div>
  );
}

function BranchChip({ code, name }: { code: string; name: string }) {
  return (
    <div className="flex items-center gap-2 rounded-md border border-slate-700 bg-slate-800/40 px-2.5 py-1.5 min-w-0">
      <span className="font-mono text-xs text-emerald-400">{code}</span>
      <span className="text-xs text-slate-300 truncate">{name}</span>
    </div>
  );
}

function KeyLine({ label, purpose, version, fp }: { label: string; purpose: string; version: number; fp: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <div className="min-w-0">
        <div className="text-xs text-slate-300">{label}</div>
        <div className="text-[10px] text-slate-500">{purpose} · v{version}</div>
      </div>
      <div className="font-mono text-[10px] text-slate-400 truncate">{shortHash(fp, 16, 12)}</div>
    </div>
  );
}
