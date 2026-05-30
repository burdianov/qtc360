"use client";

import { useQuery } from "@tanstack/react-query";
import {
  Compass,
  Layers,
  Users,
  Wrench,
  FileText,
  Building2,
  UserCheck,
  ListChecks,
} from "lucide-react";
import api from "@/lib/api";
import { useSelectedProject } from "@/hooks/use-project";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

interface DashboardStats {
  disciplines: number;
  services: number;
  systems: number;
  contractors: number;
  users: number;
  documents: number;
  requirement_templates: number;
  approvers: number;
}

const statCards = [
  { key: "disciplines", label: "Disciplines", icon: Compass, color: "bg-blue-500/15 text-blue-500" },
  { key: "services", label: "Services", icon: Layers, color: "bg-emerald-500/15 text-emerald-500" },
  { key: "systems", label: "Systems", icon: Building2, color: "bg-orange-500/15 text-orange-500" },
  { key: "users", label: "Users", icon: Users, color: "bg-purple-500/15 text-purple-500" },
  { key: "contractors", label: "Contractors", icon: Wrench, color: "bg-blue-500/15 text-blue-500" },
  { key: "documents", label: "Documents", icon: FileText, color: "bg-emerald-500/15 text-emerald-500" },
  { key: "requirement_templates", label: "Requirements", icon: ListChecks, color: "bg-amber-500/15 text-amber-500" },
  { key: "approvers", label: "Approvers", icon: UserCheck, color: "bg-orange-500/15 text-orange-500" },
] as const;

export default function DashboardPage() {
  const project = useSelectedProject();

  const { data: stats, isLoading } = useQuery<DashboardStats>({
    queryKey: ["dashboard", "stats", project?.id],
    queryFn: async () =>
      (await api.get("/dashboard/stats", { params: { project_id: project!.id } })).data,
    enabled: !!project,
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
        <p className="text-sm text-muted-foreground">
          Project overview for {project?.name || "-"}
        </p>
      </div>

      {/* Stats Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {statCards.map(({ key, label, icon: Icon, color }) => (
          <Card key={key}>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {label}
              </CardTitle>
              <div className={`flex h-9 w-9 items-center justify-center rounded-full ${color}`}>
                <Icon className="h-4 w-4" />
              </div>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <Skeleton className="h-8 w-16" />
              ) : (
                <p className="text-2xl font-bold">
                  {stats?.[key as keyof DashboardStats] ?? 0}
                </p>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Placeholder sections */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Commissioning Progress by Level</CardTitle>
          </CardHeader>
          <CardContent>
            <LevelProgress />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Tag Achievement</CardTitle>
          </CardHeader>
          <CardContent>
            <TagSummary />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function LevelProgress() {
  const project = useSelectedProject();

  const { data: requirements = [] } = useQuery<{ status: string; required_for_tag: string }[]>({
    queryKey: ["asset-requirements-all", project?.id],
    queryFn: async () => (await api.get("/commissioning/asset-requirements", { params: { project_id: project?.id } })).data,
    enabled: !!project?.id,
  });

  const levels = [
    { tag: "red", label: "L1 + L2A", color: "bg-red-500" },
    { tag: "yellow", label: "L2B", color: "bg-yellow-500" },
    { tag: "green", label: "L3", color: "bg-emerald-500" },
    { tag: "blue", label: "L4", color: "bg-blue-500" },
  ];

  return (
    <div className="space-y-4">
      {levels.map(({ tag, label, color }) => {
        const tagReqs = requirements.filter((r) => r.required_for_tag === tag);
        const achieved = tagReqs.filter((r) => r.status === "achieved").length;
        const total = tagReqs.length;
        const pct = total > 0 ? Math.round((achieved / total) * 100) : 0;
        return (
          <div key={tag} className="space-y-1">
            <div className="flex justify-between text-sm">
              <span>{label}</span>
              <span className="text-muted-foreground">{achieved}/{total} ({pct}%)</span>
            </div>
            <div className="h-2 rounded-full bg-primary/20 overflow-hidden">
              <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${pct}%` }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function TagSummary() {
  const project = useSelectedProject();

  const { data: requirements = [] } = useQuery<{ asset_id: string; status: string; required_for_tag: string }[]>({
    queryKey: ["asset-requirements-all", project?.id],
    queryFn: async () => (await api.get("/commissioning/asset-requirements", { params: { project_id: project?.id } })).data,
    enabled: !!project?.id,
  });

  // Count unique assets that achieved each tag
  const tags = ["red", "yellow", "green", "blue"] as const;
  const tagLabels = { red: "Red Tag", yellow: "Yellow Tag", green: "Green Tag", blue: "Blue Tag" };
  const tagColors = { red: "text-red-500", yellow: "text-yellow-500", green: "text-emerald-500", blue: "text-blue-500" };

  const assetIds = [...new Set(requirements.map((r) => r.asset_id))];
  const totalAssets = assetIds.length;

  const tagCounts = tags.map((tag) => {
    const achieved = assetIds.filter((assetId) => {
      const assetTagReqs = requirements.filter((r) => r.asset_id === assetId && r.required_for_tag === tag);
      return assetTagReqs.length > 0 && assetTagReqs.every((r) => r.status === "achieved");
    }).length;
    return { tag, label: tagLabels[tag], color: tagColors[tag], achieved, total: totalAssets };
  });

  return (
    <div className="grid grid-cols-2 gap-4">
      {tagCounts.map(({ tag, label, color, achieved, total }) => (
        <div key={tag} className="text-center p-3 rounded-lg border">
          <p className={`text-2xl font-bold ${color}`}>{achieved}</p>
          <p className="text-xs text-muted-foreground">{label}</p>
          <p className="text-[10px] text-muted-foreground">of {total} assets</p>
        </div>
      ))}
    </div>
  );
}
