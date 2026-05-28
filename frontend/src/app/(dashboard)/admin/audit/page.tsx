"use client";

import { useQuery } from "@tanstack/react-query";
import api from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useState } from "react";
import { formatDate } from "@/lib/format-date";

interface AuditEntry {
  id: string;
  timestamp: string;
  user: { id: string; full_name: string; email: string } | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  summary: string;
  details: Record<string, unknown> | null;
}

const actionColors: Record<string, string> = {
  create: "bg-emerald-500/15 text-emerald-500",
  update: "bg-blue-500/15 text-blue-500",
  delete: "bg-red-500/15 text-red-500",
  approved: "bg-emerald-500/15 text-emerald-500",
  rejected: "bg-red-500/15 text-red-500",
  sign: "bg-violet-500/15 text-violet-500",
};

export default function AuditPage() {
  const [actionFilter, setActionFilter] = useState("");
  const [entityFilter, setEntityFilter] = useState("");

  const { data: logs = [] } = useQuery<AuditEntry[]>({
    queryKey: ["audit-logs", actionFilter, entityFilter],
    queryFn: async () => {
      const params: Record<string, string> = {};
      if (actionFilter) params.action = actionFilter;
      if (entityFilter) params.entity_type = entityFilter;
      return (await api.get("/admin/audit-logs", { params })).data;
    },
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Audit Trail</h1>
        <p className="text-sm text-muted-foreground">Track who changed what and when</p>
      </div>

      <div className="flex gap-3">
        <Select value={actionFilter || "__all__"} onValueChange={(v) => setActionFilter(v === "__all__" ? "" : v)}>
          <SelectTrigger className="w-40"><SelectValue placeholder="Action" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">All Actions</SelectItem>
            <SelectItem value="create">Create</SelectItem>
            <SelectItem value="update">Update</SelectItem>
            <SelectItem value="delete">Delete</SelectItem>
            <SelectItem value="approved">Approved</SelectItem>
            <SelectItem value="rejected">Rejected</SelectItem>
            <SelectItem value="sign">Sign</SelectItem>
          </SelectContent>
        </Select>

        <Select value={entityFilter || "__all__"} onValueChange={(v) => setEntityFilter(v === "__all__" ? "" : v)}>
          <SelectTrigger className="w-40"><SelectValue placeholder="Entity" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">All Entities</SelectItem>
            <SelectItem value="document">Document</SelectItem>
            <SelectItem value="user">User</SelectItem>
            <SelectItem value="asset_requirement">Requirement</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        {logs.length === 0 && <p className="text-sm text-muted-foreground">No audit entries yet.</p>}
        {logs.map((entry) => (
          <div key={entry.id} className="flex items-start gap-3 rounded-md border p-3">
            <div className="h-2 w-2 rounded-full bg-primary mt-2 shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <Badge className={actionColors[entry.action] || "bg-muted text-muted-foreground"}>{entry.action}</Badge>
                <Badge variant="outline" className="text-[10px]">{entry.entity_type}</Badge>
                <span className="text-sm">{entry.summary}</span>
              </div>
              <div className="flex items-center gap-2 mt-1">
                <span className="text-[10px] text-muted-foreground">{formatDate(entry.timestamp)}</span>
                {entry.user && <span className="text-[10px] text-muted-foreground">by {entry.user.full_name}</span>}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
