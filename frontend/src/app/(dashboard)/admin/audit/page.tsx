"use client";

import { useQuery } from "@tanstack/react-query";
import api from "@/lib/api";
import { useSelectedProject } from "@/hooks/use-project";
import { Badge } from "@/components/ui/badge";

interface Document {
  id: string;
  document_type: string;
  reference_no: string;
  title: string;
  status: string;
  created_at: string;
}

interface User {
  id: string;
  full_name: string;
}

const statusColors: Record<string, string> = {
  draft: "bg-muted text-muted-foreground",
  submitted: "bg-amber-500/15 text-amber-500",
  approved: "bg-emerald-500/15 text-emerald-500",
  rejected: "bg-red-500/15 text-red-500",
  superseded: "bg-muted text-muted-foreground",
};

export default function AuditPage() {
  const project = useSelectedProject();

  const { data: documents = [] } = useQuery<Document[]>({
    queryKey: ["documents", "all", project?.id],
    queryFn: async () => (await api.get("/documents", { params: { project_id: project!.id } })).data,
    enabled: !!project,
  });

  const { data: overrides = [] } = useQuery<any[]>({
    queryKey: ["gate-overrides"],
    queryFn: async () => (await api.get("/commissioning/gate-overrides")).data,
  });

  // Sort by created_at desc
  const timeline = [
    ...documents.map((d) => ({ type: "document", data: d, date: d.created_at })),
    ...overrides.map((o) => ({ type: "gate_override", data: o, date: o.acknowledged_at || o.created_at })),
  ].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()).slice(0, 50);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Audit Trail</h1>
        <p className="text-sm text-muted-foreground">Recent document and commissioning activity</p>
      </div>

      <div className="space-y-2">
        {timeline.length === 0 && <p className="text-sm text-muted-foreground">No activity yet.</p>}
        {timeline.map((item, i) => (
          <div key={i} className="flex items-start gap-3 rounded-md border p-3">
            <div className="h-2 w-2 rounded-full bg-primary mt-2 shrink-0" />
            <div className="flex-1 min-w-0">
              {item.type === "document" && (
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge variant="outline" className="text-[10px]">{(item.data as Document).document_type}</Badge>
                  <span className="text-sm font-medium">{(item.data as Document).reference_no}</span>
                  <span className="text-sm text-muted-foreground truncate">{(item.data as Document).title}</span>
                  <Badge className={`ml-auto ${statusColors[(item.data as Document).status] || ""}`}>{(item.data as Document).status.replace(/_/g, " ")}</Badge>
                </div>
              )}
              {item.type === "gate_override" && (
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="text-[10px] border-amber-500/50 text-amber-500">Gate Override</Badge>
                  <span className="text-sm">Level {(item.data as any).level_code} — proceeded with incomplete requirements</span>
                </div>
              )}
              <p className="text-[10px] text-muted-foreground mt-1">{new Date(item.date).toLocaleString()}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
