"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { type ColumnDef } from "@tanstack/react-table";
import { Download } from "lucide-react";
import api from "@/lib/api";
import { tagColors } from "@/lib/constants";
import { useSelectedProject } from "@/hooks/use-project";
import { DataTable, DataTableColumnHeader } from "@/components/data-table";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { exportToCsv } from "@/lib/csv";

interface AssetRequirement {
  id: string;
  asset_id: string;
  requirement_template_id: string;
  status: string;
  progress_percent: number;
  required_for_tag: string;
}

interface Asset {
  id: string;
  name: string;
  tag_number: string;
}

interface RequirementTemplate {
  id: string;
  name: string;
  code: string;
  level_code: string;
}

interface AssetProgress {
  asset: Asset;
  total: number;
  achieved: number;
  progress: number;
  red_tag: boolean;
  yellow_tag: boolean;
  green_tag: boolean;
  blue_tag: boolean;
}


const statusColors: Record<string, string> = {
  not_started: "bg-muted text-muted-foreground",
  submitted: "bg-amber-500/15 text-amber-500",
  partial: "bg-orange-500/15 text-orange-500",
  achieved: "bg-emerald-500/15 text-emerald-500",
  rejected: "bg-red-500/15 text-red-500",
};

interface Discipline { id: string; name: string; }
interface Service { id: string; name: string; discipline_id: string; }
interface AssetTypeItem { id: string; name: string; service_id: string; }

export default function CommissioningTrackingPage() {
  const project = useSelectedProject();
  const [filterTag, setFilterTag] = useState<string>("");
  const [filterDiscipline, setFilterDiscipline] = useState<string>("");
  const [filterService, setFilterService] = useState<string>("");
  const [filterAssetType, setFilterAssetType] = useState<string>("");

  const { data: assets = [] } = useQuery<(Asset & { asset_type_id: string })[]>({
    queryKey: ["assets", project?.id],
    queryFn: async () => (await api.get("/assets", { params: { project_id: project?.id } })).data,
    enabled: !!project?.id,
  });

  const { data: disciplines = [] } = useQuery<Discipline[]>({
    queryKey: ["disciplines"],
    queryFn: async () => (await api.get("/disciplines")).data,
  });

  const { data: services = [] } = useQuery<Service[]>({
    queryKey: ["services"],
    queryFn: async () => (await api.get("/services")).data,
  });

  const { data: assetTypes = [] } = useQuery<AssetTypeItem[]>({
    queryKey: ["asset-types"],
    queryFn: async () => (await api.get("/asset-types")).data,
  });

  const { data: requirements = [] } = useQuery<AssetRequirement[]>({
    queryKey: ["asset-requirements-all", project?.id],
    queryFn: async () => (await api.get("/commissioning/asset-requirements", { params: { project_id: project?.id } })).data,
    enabled: !!project?.id,
  });

  const { data: templates = [] } = useQuery<RequirementTemplate[]>({
    queryKey: ["requirement-templates", project?.id],
    queryFn: async () => (await api.get("/commissioning/requirement-templates", { params: { project_id: project?.id } })).data,
    enabled: !!project?.id,
  });

  // Cascade filter options
  const filteredServices = filterDiscipline ? services.filter((s) => s.discipline_id === filterDiscipline) : services;
  const filteredAssetTypes = filterService ? assetTypes.filter((t) => t.service_id === filterService) : filterDiscipline ? assetTypes.filter((t) => filteredServices.some((s) => s.id === t.service_id)) : assetTypes;

  // Build set of asset IDs matching hierarchy filters
  const filteredAssetIds = new Set(
    assets
      .filter((a) => {
        if (filterAssetType) return a.asset_type_id === filterAssetType;
        if (filterService) return assetTypes.some((t) => t.id === a.asset_type_id && t.service_id === filterService);
        if (filterDiscipline) return assetTypes.some((t) => t.id === a.asset_type_id && filteredServices.some((s) => s.id === t.service_id));
        return true;
      })
      .map((a) => a.id)
  );

  // Build progress summary per asset
  const progressData: AssetProgress[] = assets
    .filter((a) => filteredAssetIds.has(a.id))
    .map((asset) => {
      const assetReqs = requirements.filter((r) => r.asset_id === asset.id);
      const total = assetReqs.length;
      const achieved = assetReqs.filter((r) => r.status === "achieved").length;
      const progress = total > 0 ? Math.round((achieved / total) * 100) : 0;

      const byTag = (tag: string) => {
        const tagReqs = assetReqs.filter((r) => r.required_for_tag === tag);
        return tagReqs.length > 0 && tagReqs.every((r) => r.status === "achieved");
      };

      return {
        asset,
        total,
        achieved,
        progress,
        red_tag: byTag("red"),
        yellow_tag: byTag("yellow"),
        green_tag: byTag("green"),
        blue_tag: byTag("blue"),
      };
    })
    .filter((p) => p.total > 0);

  const columns: ColumnDef<AssetProgress, unknown>[] = [
    { accessorKey: "asset.tag_number", header: ({ column }) => <DataTableColumnHeader column={column} title="Tag" />, cell: ({ row }) => <span className="font-mono text-xs">{row.original.asset.tag_number}</span> },
    { accessorKey: "asset.name", header: ({ column }) => <DataTableColumnHeader column={column} title="Asset" /> },
    { accessorKey: "progress", header: ({ column }) => <DataTableColumnHeader column={column} title="Progress" />, cell: ({ row }) => (
      <div className="flex items-center gap-2 min-w-[120px]">
        <Progress value={row.original.progress} className="h-2 flex-1" />
        <span className="text-xs text-muted-foreground w-8">{row.original.progress}%</span>
      </div>
    )},
    { accessorKey: "achieved", header: "Done", cell: ({ row }) => <span className="text-xs">{row.original.achieved}/{row.original.total}</span> },
    { id: "tags", header: "Tags", cell: ({ row }) => (
      <div className="flex gap-1">
        {row.original.red_tag && <Badge className={tagColors.red}>Red</Badge>}
        {row.original.yellow_tag && <Badge className={tagColors.yellow}>Yellow</Badge>}
        {row.original.green_tag && <Badge className={tagColors.green}>Green</Badge>}
        {row.original.blue_tag && <Badge className={tagColors.blue}>Blue</Badge>}
        {!row.original.red_tag && !row.original.yellow_tag && !row.original.green_tag && !row.original.blue_tag && (
          <span className="text-xs text-muted-foreground">—</span>
        )}
      </div>
    )},
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Commissioning Tracking</h1>
          <p className="text-sm text-muted-foreground">Asset progress through commissioning levels</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => exportToCsv(progressData.map((p) => ({ tag_number: p.asset.tag_number, name: p.asset.name, progress: `${p.progress}%`, achieved: `${p.achieved}/${p.total}`, red_tag: p.red_tag ? "Yes" : "No", yellow_tag: p.yellow_tag ? "Yes" : "No", green_tag: p.green_tag ? "Yes" : "No", blue_tag: p.blue_tag ? "Yes" : "No" })), "commissioning-progress")}>
          <Download className="h-4 w-4 mr-1" />Export CSV
        </Button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-center">
        <Select value={filterDiscipline || "__all__"} onValueChange={(v) => { setFilterDiscipline(v === "__all__" ? "" : v); setFilterService(""); setFilterAssetType(""); }}>
          <SelectTrigger className="w-44"><SelectValue>{filterDiscipline ? disciplines.find((d) => d.id === filterDiscipline)?.name : "All Disciplines"}</SelectValue></SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">All Disciplines</SelectItem>
            {disciplines.map((d) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
          </SelectContent>
        </Select>

        <Select value={filterService || "__all__"} onValueChange={(v) => { setFilterService(v === "__all__" ? "" : v); setFilterAssetType(""); }}>
          <SelectTrigger className="w-44"><SelectValue>{filterService ? filteredServices.find((s) => s.id === filterService)?.name : "All Services"}</SelectValue></SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">All Services</SelectItem>
            {filteredServices.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
          </SelectContent>
        </Select>

        <Select value={filterAssetType || "__all__"} onValueChange={(v) => setFilterAssetType(v === "__all__" ? "" : v)}>
          <SelectTrigger className="w-44"><SelectValue>{filterAssetType ? filteredAssetTypes.find((t) => t.id === filterAssetType)?.name : "All Asset Types"}</SelectValue></SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">All Asset Types</SelectItem>
            {filteredAssetTypes.map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
          </SelectContent>
        </Select>

        <Select value={filterTag || "__all__"} onValueChange={(v: any) => setFilterTag(v === "__all__" ? "" : v)}>
          <SelectTrigger className="w-44"><SelectValue>{filterTag ? `${filterTag.charAt(0).toUpperCase() + filterTag.slice(1)} Tag` : "All Tags"}</SelectValue></SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">All Tags</SelectItem>
            <SelectItem value="red">Red Tag (not achieved)</SelectItem>
            <SelectItem value="yellow">Yellow Tag (not achieved)</SelectItem>
            <SelectItem value="green">Green Tag (not achieved)</SelectItem>
            <SelectItem value="blue">Blue Tag (not achieved)</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Summary cards */}
      <div className="grid gap-4 sm:grid-cols-4">
        <SummaryCard label="Total Assets" value={progressData.length} />
        <SummaryCard label="Red Tags Achieved" value={progressData.filter((p) => p.red_tag).length} color="text-red-500" />
        <SummaryCard label="Yellow Tags Achieved" value={progressData.filter((p) => p.yellow_tag).length} color="text-yellow-500" />
        <SummaryCard label="Green Tags Achieved" value={progressData.filter((p) => p.green_tag).length} color="text-emerald-500" />
      </div>

      <DataTable
        columns={columns}
        data={filterTag ? progressData.filter((p) => !p[`${filterTag}_tag` as keyof AssetProgress]) : progressData}
        searchKey="asset.tag_number"
        searchPlaceholder="Search by tag number..."
      />
    </div>
  );
}

function SummaryCard({ label, value, color }: { label: string; value: number; color?: string }) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`text-2xl font-bold mt-1 ${color || ""}`}>{value}</p>
    </div>
  );
}
