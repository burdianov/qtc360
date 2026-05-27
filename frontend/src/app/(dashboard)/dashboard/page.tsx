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
          Project overview for {project?.name || "—"}
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
            <CardTitle className="text-base">Commissioning Progress</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex h-48 items-center justify-center text-sm text-muted-foreground">
              Chart will be available once commissioning tracking is implemented
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Recent Activity</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex h-48 items-center justify-center text-sm text-muted-foreground">
              Activity feed will appear here once document workflows are active
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
