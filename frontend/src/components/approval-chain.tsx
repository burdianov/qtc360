"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, XCircle, Clock, Send } from "lucide-react";
import api from "@/lib/api";
import { useSelectedProject } from "@/hooks/use-project";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { useState } from "react";

interface ProjectApprover {
  id: string;
  approver: { id: string; name: string; code: string };
  approver_title: { id: string; code: string; title: string };
}

interface ApprovalStatus {
  id: string;
  letter: string;
  name: string;
  action: string;
}

interface DocumentApproval {
  id: string;
  document_id: string;
  approver_order: number;
  project_approver_id: string;
  status_id: string | null;
  comments: string | null;
}

interface Props {
  documentId: string;
  documentStatus: string;
}

export function ApprovalChain({ documentId, documentStatus }: Props) {
  const project = useSelectedProject();
  const queryClient = useQueryClient();
  const [respondingId, setRespondingId] = useState<string | null>(null);
  const [selectedStatusId, setSelectedStatusId] = useState("");
  const [comments, setComments] = useState("");

  const { data: approvals = [] } = useQuery<DocumentApproval[]>({
    queryKey: ["approvals", documentId],
    queryFn: async () => (await api.get(`/documents/${documentId}/approvals`)).data,
    enabled: !!documentId,
  });

  const { data: projectApprovers = [] } = useQuery<ProjectApprover[]>({
    queryKey: ["project-approvers"],
    queryFn: async () => (await api.get("/project-approvers")).data,
  });

  const { data: approvalStatuses = [] } = useQuery<ApprovalStatus[]>({
    queryKey: ["approval-statuses"],
    queryFn: async () => (await api.get("/approval-statuses")).data,
  });

  const addApproverMutation = useMutation({
    mutationFn: (data: { project_approver_id: string; approver_order: number }) =>
      api.post(`/documents/${documentId}/approvals`, data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["approvals", documentId] }),
  });

  const respondMutation = useMutation({
    mutationFn: ({ approvalId, status_id, comments }: { approvalId: string; status_id: string; comments: string }) =>
      api.post(`/documents/${documentId}/approvals/${approvalId}/respond`, { status_id, comments }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["approvals", documentId] });
      queryClient.invalidateQueries({ queryKey: ["document", documentId] });
      queryClient.invalidateQueries({ queryKey: ["documents"] });
      setRespondingId(null);
      setSelectedStatusId("");
      setComments("");
      toast.success("Approval response recorded");
    },
  });

  const approverMap = Object.fromEntries(projectApprovers.map((pa) => [pa.id, pa]));
  const statusMap = Object.fromEntries(approvalStatuses.map((s) => [s.id, s]));

  // Only show if document is submitted or beyond
  if (documentStatus === "draft") return null;

  const isSubmitted = ["submitted", "approved", "approved_with_comments", "rejected"].includes(documentStatus);

  // Setup approvers if none assigned yet
  const setupApprovers = () => {
    projectApprovers.forEach((pa, i) => {
      const exists = approvals.find((a) => a.project_approver_id === pa.id);
      if (!exists) {
        addApproverMutation.mutate({ project_approver_id: pa.id, approver_order: i + 1 });
      }
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium">Approval Chain</h3>
        {isSubmitted && approvals.length === 0 && projectApprovers.length > 0 && (
          <Button size="sm" variant="outline" onClick={setupApprovers}>
            <Send className="h-3 w-3 mr-1" />Assign Approvers
          </Button>
        )}
      </div>

      {approvals.length === 0 && (
        <p className="text-xs text-muted-foreground">
          {documentStatus === "submitted" ? "Assign approvers to start the approval chain." : "No approvers assigned."}
        </p>
      )}

      <div className="space-y-2">
        {approvals.sort((a, b) => a.approver_order - b.approver_order).map((approval) => {
          const pa = approverMap[approval.project_approver_id];
          const status = approval.status_id ? statusMap[approval.status_id] : null;
          const isCurrentApprover = !approval.status_id && approvals.filter((a) => a.approver_order < approval.approver_order).every((a) => a.status_id);

          return (
            <div key={approval.id} className="flex items-start gap-3 rounded-md border p-3">
              <div className="mt-0.5">
                {status?.action === "approved" && <CheckCircle2 className="h-4 w-4 text-emerald-500" />}
                {status?.action === "rejected" && <XCircle className="h-4 w-4 text-red-500" />}
                {!status && <Clock className="h-4 w-4 text-muted-foreground" />}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">{pa?.approver?.name || "Unknown"}</span>
                  <Badge variant="outline" className="text-[10px]">{pa?.approver_title?.title || ""}</Badge>
                  <span className="text-xs text-muted-foreground">#{approval.approver_order}</span>
                </div>
                {status && (
                  <div className="mt-1">
                    <Badge className={status.action === "approved" ? "bg-emerald-500/15 text-emerald-500" : "bg-red-500/15 text-red-500"}>
                      {status.letter} — {status.name}
                    </Badge>
                    {approval.comments && <p className="text-xs text-muted-foreground mt-1">{approval.comments}</p>}
                  </div>
                )}
                {/* Respond UI */}
                {isCurrentApprover && documentStatus === "submitted" && (
                  <div className="mt-2 space-y-2">
                    {respondingId === approval.id ? (
                      <>
                        <Select value={selectedStatusId} onValueChange={(v: any) => setSelectedStatusId(v)}>
                          <SelectTrigger className="h-8"><SelectValue placeholder="Select response">{selectedStatusId ? `${statusMap[selectedStatusId]?.letter} — ${statusMap[selectedStatusId]?.name}` : ""}</SelectValue></SelectTrigger>
                          <SelectContent>
                            {approvalStatuses.map((s) => <SelectItem key={s.id} value={s.id}>{s.letter} — {s.name}</SelectItem>)}
                          </SelectContent>
                        </Select>
                        <Textarea placeholder="Comments (optional)" value={comments} onChange={(e) => setComments(e.target.value)} className="h-16 text-sm" />
                        <div className="flex gap-2">
                          <Button size="sm" disabled={!selectedStatusId || respondMutation.isPending} onClick={() => respondMutation.mutate({ approvalId: approval.id, status_id: selectedStatusId, comments })}>
                            {respondMutation.isPending ? "Saving..." : "Submit Response"}
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => setRespondingId(null)}>Cancel</Button>
                        </div>
                      </>
                    ) : (
                      <Button size="sm" variant="outline" className="mt-1" onClick={() => setRespondingId(approval.id)}>Record Response</Button>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
