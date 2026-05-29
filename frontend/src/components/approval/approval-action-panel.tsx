"use client";

import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, XCircle, Clock, Send, FileUp, RotateCcw, MessageSquare } from "lucide-react";
import { toast } from "sonner";

import api from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { SubmitToApproverDialog } from "./submit-to-approver-dialog";
import { RecordResponseDialog } from "./record-response-dialog";
import { AddRemarksDialog } from "./add-remarks-dialog";
import { ApprovalRoundsList } from "./approval-rounds-list";
import { useRouter } from "next/navigation";

export interface ApprovalStatus {
  id: string;
  letter: string;
  name: string;
  action: string;
  description?: string;
}

export interface ApprovalRound {
  id: string;
  document_id: string;
  approver_order: number;
  round_no: number;
  project_approver_id: string;
  decision_status_id: string | null;
  signatory_name: string | null;
  comments: string | null;
  submitted_at: string | null;
  returned_at: string | null;
  response_date: string | null;
  response_time: string | null;
  returned_file_name: string | null;
  remarks_file_name: string | null;
}

export interface ProjectApprover {
  id: string;
  document_type: string | null;
  approver_order: number | null;
  approver: { id: string; name: string; code: string };
}

interface Props {
  documentId: string;
  documentType: string;
  documentStatus: string;
  projectId: string | undefined;
  onChanged?: () => void;
}

const STATUS_LABELS: Record<string, { label: string; tone: "muted" | "info" | "warning" | "success" | "danger" }> = {
  draft: { label: "Draft", tone: "muted" },
  internally_signed: { label: "Internally signed", tone: "info" },
  with_approver_1: { label: "With Approver 1", tone: "warning" },
  approver_1_returned: { label: "Approver 1 returned", tone: "info" },
  with_approver_2: { label: "With Approver 2", tone: "warning" },
  approved: { label: "Approved", tone: "success" },
  approved_with_comments: { label: "Approved with comments", tone: "success" },
  rejected: { label: "Rejected", tone: "danger" },
  superseded: { label: "Superseded", tone: "muted" },
  cancelled: { label: "Cancelled", tone: "muted" },
};

export function ApprovalActionPanel({
  documentId,
  documentType,
  documentStatus,
  projectId,
  onChanged,
}: Props) {
  const qc = useQueryClient();
  const router = useRouter();

  const [submitOpen, setSubmitOpen] = useState(false);
  const [submitOrder, setSubmitOrder] = useState<number>(1);
  const [recordOpen, setRecordOpen] = useState(false);
  const [recordOrder, setRecordOrder] = useState<number>(1);
  const [remarksOpen, setRemarksOpen] = useState(false);
  const [remarksRound, setRemarksRound] = useState<ApprovalRound | null>(null);

  const { data: rounds = [] } = useQuery<ApprovalRound[]>({
    queryKey: ["approval-rounds", documentId],
    queryFn: async () => (await api.get(`/documents/${documentId}/approval-rounds`)).data,
    enabled: !!documentId,
  });

  const { data: projectApprovers = [] } = useQuery<ProjectApprover[]>({
    queryKey: ["project-approvers", projectId],
    queryFn: async () => (await api.get("/project-approvers", { params: { project_id: projectId } })).data,
    enabled: !!projectId,
  });

  const { data: approvalStatuses = [] } = useQuery<ApprovalStatus[]>({
    queryKey: ["approval-statuses", projectId],
    queryFn: async () => (await api.get("/approval-statuses", { params: { project_id: projectId } })).data,
    enabled: !!projectId,
  });

  const chain = useMemo(() => {
    return projectApprovers
      .filter((pa) => pa.document_type === documentType)
      .sort((a, b) => (a.approver_order ?? 0) - (b.approver_order ?? 0));
  }, [projectApprovers, documentType]);

  const approver1Round = rounds.find((r) => r.approver_order === 1) || null;
  const approver1Letter = useMemo(() => {
    if (!approver1Round?.decision_status_id) return null;
    const s = approvalStatuses.find((a) => a.id === approver1Round.decision_status_id);
    return s?.letter?.toUpperCase() || null;
  }, [approver1Round, approvalStatuses]);

  const startNewRevisionMutation = useMutation({
    mutationFn: async () => (await api.post(`/documents/${documentId}/start-new-revision`)).data,
    onSuccess: (newDoc) => {
      toast.success(`Started revision ${newDoc.revision_no}`);
      qc.invalidateQueries({ queryKey: ["documents"] });
      router.push(`/qaqc/${documentType.toLowerCase()}/new?id=${newDoc.id}`);
    },
    onError: (err: unknown) => {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      toast.error(detail || "Could not start new revision");
    },
  });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["approval-rounds", documentId] });
    qc.invalidateQueries({ queryKey: ["round-attachments"] });
    qc.invalidateQueries({ queryKey: ["document", documentId] });
    qc.invalidateQueries({ queryKey: ["documents"] });
    onChanged?.();
  };

  const statusMeta = STATUS_LABELS[documentStatus] || { label: documentStatus, tone: "muted" as const };

  // Action for current state. Spec table → exactly one primary action per state.
  let primary: React.ReactNode = null;
  if (documentStatus === "internally_signed") {
    primary = (
      <Button onClick={() => { setSubmitOrder(1); setSubmitOpen(true); }}>
        <Send className="mr-2 h-4 w-4" />Submit to Approver 1
      </Button>
    );
  } else if (documentStatus === "with_approver_1") {
    primary = (
      <Button onClick={() => { setRecordOrder(1); setRecordOpen(true); }}>
        <FileUp className="mr-2 h-4 w-4" />Record Approver 1 Response
      </Button>
    );
  } else if (documentStatus === "approver_1_returned") {
    if (approver1Letter === "C") {
      primary = (
        <Button onClick={() => startNewRevisionMutation.mutate()}>
          <RotateCcw className="mr-2 h-4 w-4" />Start New Revision
        </Button>
      );
    } else {
      // A / B / D → submit to Approver 2.
      primary = (
        <Button onClick={() => { setSubmitOrder(2); setSubmitOpen(true); }}>
          <Send className="mr-2 h-4 w-4" />Submit to Approver 2
        </Button>
      );
    }
  } else if (documentStatus === "with_approver_2") {
    primary = (
      <Button onClick={() => { setRecordOrder(2); setRecordOpen(true); }}>
        <FileUp className="mr-2 h-4 w-4" />Record Approver 2 Response
      </Button>
    );
  } else if (documentStatus === "rejected") {
    primary = (
      <Button onClick={() => startNewRevisionMutation.mutate()}>
        <RotateCcw className="mr-2 h-4 w-4" />Start New Revision
      </Button>
    );
  }

  const chainPreview = chain.length > 0 ? (
    <div className="rounded-md border divide-y">
      {chain.map((pa) => {
        const round = rounds.find((r) => r.approver_order === pa.approver_order) || null;
        const decision = round?.decision_status_id
          ? approvalStatuses.find((s) => s.id === round.decision_status_id)
          : null;
        let icon = <Clock className="h-4 w-4 text-muted-foreground" />;
        if (decision?.letter?.toUpperCase() === "C") {
          icon = <XCircle className="h-4 w-4 text-red-500" />;
        } else if (decision) {
          icon = <CheckCircle2 className="h-4 w-4 text-emerald-500" />;
        }
        return (
          <div key={pa.id} className="flex items-center gap-3 px-3 py-2 text-sm">
            {icon}
            <div className="flex h-6 w-6 items-center justify-center rounded-full bg-muted text-[10px] font-semibold">
              {pa.approver_order}
            </div>
            <div className="flex-1 min-w-0">
              <div className="truncate">{pa.approver.name}</div>
              {decision && (
                <div className="text-[11px] text-muted-foreground">
                  {decision.letter} — {decision.name}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  ) : (
    <div className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
      No approver chain for {documentType}. Configure in Settings.
    </div>
  );

  if (documentStatus === "draft") {
    return null;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <h3 className="text-sm font-medium">External Approval</h3>
        <Badge
          variant={statusMeta.tone === "danger" ? "destructive" : "outline"}
          className={
            statusMeta.tone === "success" ? "border-emerald-500/30 text-emerald-500" :
            statusMeta.tone === "warning" ? "border-amber-500/30 text-amber-500" :
            statusMeta.tone === "info" ? "border-sky-500/30 text-sky-500" :
            ""
          }
        >
          {statusMeta.label}
        </Badge>
      </div>

      {chainPreview}

      <ApprovalRoundsList
        documentId={documentId}
        rounds={rounds}
        projectApprovers={chain}
        approvalStatuses={approvalStatuses}
        locked={["approved", "approved_with_comments", "rejected", "superseded", "cancelled"].includes(documentStatus)}
        onReplace={(order) => { setRecordOrder(order); setRecordOpen(true); }}
      />

      {primary && <div className="pt-1">{primary}</div>}

      <SubmitToApproverDialog
        open={submitOpen}
        onOpenChange={setSubmitOpen}
        documentId={documentId}
        approverOrder={submitOrder}
        approverName={chain.find((c) => c.approver_order === submitOrder)?.approver.name || ""}
        onSuccess={refresh}
      />
      <RecordResponseDialog
        open={recordOpen}
        onOpenChange={setRecordOpen}
        documentId={documentId}
        approverOrder={recordOrder}
        approverName={chain.find((c) => c.approver_order === recordOrder)?.approver.name || ""}
        approvalStatuses={approvalStatuses}
        roundId={rounds.find((r) => r.approver_order === recordOrder && r.decision_status_id)?.id}
        onSuccess={refresh}
      />
      <AddRemarksDialog
        open={remarksOpen}
        onOpenChange={setRemarksOpen}
        documentId={documentId}
        round={remarksRound}
        onSuccess={refresh}
      />
    </div>
  );
}
