"use client";

import { useEffect, useState, useCallback } from "react";
import {
  Network,
  Plus,
  KeyRound,
  Building2,
  Loader2,
  ChevronRight,
  ArrowDownToLine,
  ArrowUpFromLine,
} from "lucide-react";
import { api } from "@/lib/api";
import type { Branch, BranchType } from "@/lib/types";
import { BRANCH_TYPE_META } from "@/lib/format";
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
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

const TYPES: BranchType[] = ["HEADQUARTERS", "REGIONAL", "DEPARTMENT", "SUB_BRANCH"];

interface TreeNode extends Branch {
  children: TreeNode[];
}

export function BranchesSection() {
  const [branches, setBranches] = useState<Branch[]>([]);
  const [loading, setLoading] = useState(true);
  const [addOpen, setAddOpen] = useState(false);
  const { toast } = useToast();

  const load = useCallback(async () => {
    try {
      const res = await api.branches();
      setBranches(res.branches);
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
        const res = await api.branches();
        if (isMounted) setBranches(res.branches);
      } catch {
        // 401 → auth:unauthorized event flips to login; other errors keep state.
      } finally {
        if (isMounted) setLoading(false);
      }
    };
    loadData();
    return () => { isMounted = false; };
  }, []);

  const tree = buildTree(branches);

  return (
    <div className="space-y-5">
      <Panel>
        <PanelHeader
          title="Branch Network"
          subtitle="Hierarchical topology with compartmentalized trust domains"
          icon={<Network className="h-4 w-4" />}
          action={
            <Button size="sm" onClick={() => setAddOpen(true)} className="bg-emerald-600 hover:bg-emerald-500 text-white">
              <Plus className="h-4 w-4" /> Add Branch
            </Button>
          }
        />
        <div className="p-3 md:p-4">
          {/* Legend */}
          <div className="flex flex-wrap gap-2 mb-4">
            {TYPES.map((t) => {
              const meta = BRANCH_TYPE_META[t];
              const count = branches.filter((b) => b.type === t).length;
              return (
                <Badge key={t} className={cn("border", meta.color)}>
                  <span className={cn("h-1.5 w-1.5 rounded-full", meta.dot)} />
                  {meta.label} · {count}
                </Badge>
              );
            })}
          </div>

          {loading ? (
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="h-12 rounded-lg bg-slate-800/40 animate-pulse" />
              ))}
            </div>
          ) : tree.length === 0 ? (
            <EmptyState icon={<Network className="h-10 w-10" />} title="No branches" description="Add your first branch to begin." />
          ) : (
            <div className="space-y-1 overflow-x-auto">
              {tree.map((node) => (
                <BranchRow key={node.id} node={node} depth={0} />
              ))}
            </div>
          )}
        </div>
      </Panel>

      <AddBranchDialog open={addOpen} onOpenChange={setAddOpen} branches={branches} onCreated={load} toast={toast} />
    </div>
  );
}

function BranchRow({ node, depth }: { node: TreeNode; depth: number }) {
  const meta = BRANCH_TYPE_META[node.type as BranchType] ?? BRANCH_TYPE_META.DEPARTMENT;
  return (
    <>
      <div
        className="group flex items-center gap-2 rounded-lg px-2 py-2 hover:bg-slate-800/40 transition-colors"
        style={{ paddingLeft: `${depth * 1.5 + 0.5}rem` }}
      >
        {depth > 0 && <div className="h-px w-3 bg-slate-700 shrink-0" />}
        <span className={cn("h-2.5 w-2.5 rounded-full shrink-0 ring-2 ring-slate-900", meta.dot)} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-slate-200 truncate">{node.name}</span>
            <span className="text-[10px] font-mono text-slate-500 shrink-0">{node.code}</span>
          </div>
          {node.region && <div className="text-[11px] text-slate-500">{node.region}</div>}
        </div>
        <Badge className={cn("border", meta.color)}>{meta.label}</Badge>
        <div className="hidden sm:flex items-center gap-1.5 shrink-0">
          <span className="inline-flex items-center gap-1 text-[11px] text-slate-400" title="Key pairs">
            <KeyRound className="h-3 w-3" /> {node._count?.keys ?? 0}
          </span>
          <span className="inline-flex items-center gap-1 text-[11px] text-teal-400" title="Sent">
            <ArrowUpFromLine className="h-3 w-3" /> {node._count?.sentDocs ?? 0}
          </span>
          <span className="inline-flex items-center gap-1 text-[11px] text-emerald-400" title="Received">
            <ArrowDownToLine className="h-3 w-3" /> {node._count?.receivedDocs ?? 0}
          </span>
        </div>
      </div>
      {node.children.map((c) => (
        <BranchRow key={c.id} node={c} depth={depth + 1} />
      ))}
    </>
  );
}

function AddBranchDialog({
  open,
  onOpenChange,
  branches,
  onCreated,
  toast,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  branches: Branch[];
  onCreated: () => void;
  toast: ReturnType<typeof useToast>["toast"];
}) {
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [type, setType] = useState<BranchType>("DEPARTMENT");
  const [region, setRegion] = useState("");
  const [parentId, setParentId] = useState("");
  const [saving, setSaving] = useState(false);

  const reset = () => {
    setName(""); setCode(""); setType("DEPARTMENT"); setRegion(""); setParentId("");
  };

  const handleSave = async () => {
    if (!name || !code) {
      toast({ title: "Missing fields", description: "Name and code are required.", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      await api.createBranch({ name, code, type, region: region || undefined, parentId: parentId || undefined });
      toast({
        title: "Branch created",
        description: `${code} provisioned with new ECC P-521 key pairs (ENCRYPTION + SIGNING).`,
      });
      reset();
      onOpenChange(false);
      await onCreated();
    } catch (e) {
      toast({ title: "Failed to create branch", description: e instanceof Error ? e.message : "Error", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) reset(); }}>
      <DialogContent className="bg-slate-900 border-slate-700 text-slate-100 max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-slate-100">
            <Building2 className="h-5 w-5 text-emerald-400" /> Provision New Branch
          </DialogTitle>
          <DialogDescription className="text-slate-400">
            A new branch receives two ECC P-521 key pairs (ECDH + ECDSA) on creation.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div className="space-y-1.5">
            <Label className="text-slate-300 text-xs">Branch name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Department D3" className="bg-slate-950/60 border-slate-700 text-slate-100" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-slate-300 text-xs">Code</Label>
              <Input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="DEPT-D3" className="bg-slate-950/60 border-slate-700 text-slate-100 font-mono" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-slate-300 text-xs">Type</Label>
              <Select value={type} onValueChange={(v) => setType(v as BranchType)}>
                <SelectTrigger className="bg-slate-950/60 border-slate-700 text-slate-100"><SelectValue /></SelectTrigger>
                <SelectContent className="bg-slate-900 border-slate-700">
                  {TYPES.map((t) => (
                    <SelectItem key={t} value={t} className="text-slate-100 focus:bg-slate-800">{BRANCH_TYPE_META[t].label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-slate-300 text-xs">Region (optional)</Label>
            <Input value={region} onChange={(e) => setRegion(e.target.value)} placeholder="e.g. North America" className="bg-slate-950/60 border-slate-700 text-slate-100" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-slate-300 text-xs">Parent branch</Label>
            <Select value={parentId} onValueChange={setParentId}>
              <SelectTrigger className="bg-slate-950/60 border-slate-700 text-slate-100"><SelectValue placeholder="None (top-level)" /></SelectTrigger>
              <SelectContent className="bg-slate-900 border-slate-700 max-h-72">
                {branches.map((b) => (
                  <SelectItem key={b.id} value={b.id} className="text-slate-100 focus:bg-slate-800">
                    <span className="font-mono text-xs text-emerald-400 mr-2">{b.code}</span>{b.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} className="text-slate-300 hover:bg-slate-800">Cancel</Button>
          <Button onClick={handleSave} disabled={saving} className="bg-emerald-600 hover:bg-emerald-500 text-white">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            Provision Branch
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function buildTree(branches: Branch[]): TreeNode[] {
  const map = new Map<string, TreeNode>();
  branches.forEach((b) => map.set(b.id, { ...b, children: [] }));
  const roots: TreeNode[] = [];
  branches.forEach((b) => {
    const node = map.get(b.id)!;
    if (b.parentId && map.has(b.parentId)) {
      map.get(b.parentId)!.children.push(node);
    } else {
      roots.push(node);
    }
  });
  return roots;
}
