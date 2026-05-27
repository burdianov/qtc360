"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { type ColumnDef } from "@tanstack/react-table";
import api from "@/lib/api";
import { useSelectedProject } from "@/hooks/use-project";
import { DataTable, DataTableColumnHeader } from "@/components/data-table";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface Asset { id: string; name: string; tag_number: string; }
interface RequirementTemplate { id: string; name: string; code: string; level_code: string; requirement_category: string; }
interface AssetRequirement {
  id: string;
  asset_id: string;
  requirement_template_id: string;
  status: string;
  progress_percent: number;
  required_for_tag: string;
  target_date: string | null;
  actual_completion_date: string | null;
}

const statusColors: Record<string, string> = {
  not_started: "bg-muted text-muted-foreground",
  submitted: "bg-amber-500/15 text-amber-500",
  partial: "bg-orange-500/15 text-orange-500",
  achieved: "bg-emerald-500/15 text-emerald-500",
  rejected: "bg-red-500/15 text-red-500",
  not_applicable: "bg-muted text-muted-foreground",
};

const levelColors: Record<string, string> = {
  L1: "bg-red-500/15 text-red-500",
  L2A: "bg-red-500/15 text-red-500",
  L2B: "bg-yellow-500/15 text-yellow-600",
  L3: "bg-emerald-500/15 text-emerald-500",
  L4: "bg-blue-500/15 text-blue-500",
};

export default function CommissioningRequirementsPage() {
  const project = useSelectedProject();
  const [selectedAssetId, setSelectedAssetId] = useState<string>("");

  const { data: assets = [] } = useQuery<Asset[]>({
    queryKey: ["assets"],
    queryFn: async () => (await api.get("/assets")).data,
  });

  const { data: templates = [] } = useQuery<RequirementTemplate[]>({
    queryKey: ["requirement-templates", project?.id],
    queryFn: async () => (await api.get("/commissioning/requirement-templates", { params: { project_id: project?.id } })).data,
    enabled: !!project?.id,
  });

  const { data: requirements = [] } = useQuery<AssetRequirement[]>({
    queryKey: ["asset-requirements", selectedAssetId],
    queryFn: async () => (await api.get("/commissioning/asset-requirements", { params: { asset_id: selectedAssetId } })).data,
    enabled: !!selectedAssetId,
  });

  const templateMap = Object.fromEntries(templates.map((t) => [t.id, t]));

  const tableData = requirements.map((r) => ({
    ...r,
    template: templateMap[r.requirement_template_id],
  }));

  type Row = typeof tableData[number];

  const columns: ColumnDef<Row, unknown>[] = [
    { accessorKey: "template.level_code", header: ({ column }) => <DataTableColumnHeader column={column} title="Level" />, cell: ({ row }) => {
      const level = row.original.template?.level_code || "";
      return <Badge className={levelColors[level] || ""}>{level}</Badge>;
    }},
    { accessorKey: "template.code", header: ({ column }) => <DataTableColumnHeader column={column} title="Code" />, cell: ({ row }) => <span className="font-mono text-xs">{row.original.template?.code}</span> },
    { accessorKey: "template.name", header: ({ column }) => <DataTableColumnHeader column={column} title="Requirement" /> },
    { accessorKey: "status", header: ({ column }) => <DataTableColumnHeader column={column} title="Status" />, cell: ({ row }) => <Badge className={statusColors[row.original.status] || ""}>{row.original.status.replace(/_/g, " ")}</Badge> },
    { accessorKey: "progress_percent", header: "Progress", cell: ({ row }) => (
      <div className="flex items-center gap-2 min-w-[80px]">
        <div className="h-1.5 flex-1 rounded-full bg-primary/20 overflow-hidden">
          <div className="h-full bg-primary rounded-full" style={{ width: `${row.original.progress_percent}%` }} />
        </div>
        <span className="text-[10px] text-muted-foreground w-7">{row.original.progress_percent}%</span>
      </div>
    )},
    { accessorKey: "required_for_tag", header: "Tag", cell: ({ row }) => <Badge variant="outline" className="text-xs capitalize">{row.original.required_for_tag}</Badge> },
    { accessorKey: "target_date", header: "Target", cell: ({ row }) => <span className="text-xs">{row.original.target_date || "—"}</span> },
    { accessorKey: "actual_completion_date", header: "Completed", cell: ({ row }) => <span className="text-xs">{row.original.actual_completion_date || "—"}</span> },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Asset Requirements</h1>
        <p className="text-sm text-muted-foreground">View commissioning requirements per asset</p>
      </div>

      <div className="max-w-sm">
        <label className="text-xs text-muted-foreground mb-1.5 block">Select Asset</label>
        <Select value={selectedAssetId} onValueChange={(v: any) => setSelectedAssetId(v)}>
          <SelectTrigger><SelectValue placeholder="Choose an asset...">{selectedAssetId ? (() => { const a = assets.find((x) => x.id === selectedAssetId); return a ? `${a.tag_number} — ${a.name}` : ""; })() : ""}</SelectValue></SelectTrigger>
          <SelectContent>
            {assets.map((a) => <SelectItem key={a.id} value={a.id}>{a.tag_number} — {a.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {selectedAssetId && (
        <DataTable
          columns={columns}
          data={tableData}
          searchKey="template.name"
          searchPlaceholder="Search requirements..."
        />
      )}

      {!selectedAssetId && (
        <div className="flex h-48 items-center justify-center text-sm text-muted-foreground border rounded-lg">
          Select an asset to view its commissioning requirements
        </div>
      )}
    </div>
  );
}
