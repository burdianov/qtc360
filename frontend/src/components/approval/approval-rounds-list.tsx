"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight, FileText, MessageSquare } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import type { ApprovalRound, ApprovalStatus, ProjectApprover } from "./approval-action-panel";

interface Props {
  documentId: string;
  rounds: ApprovalRound[];
  projectApprovers: ProjectApprover[];
  approvalStatuses: ApprovalStatus[];
}

export function ApprovalRoundsList({
  documentId,
  rounds,
  projectApprovers,
  approvalStatuses,
}: Props) {
  if (rounds.length === 0) return null;

  return (
    <div className="space-y-2">
      <h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Rounds</h4>
      <div className="space-y-2">
        {rounds.map((round) => (
          <RoundCard
            key={round.id}
            documentId={documentId}
            round={round}
            party={
              projectApprovers.find((pa) => pa.approver_order === round.approver_order)?.approver.name || "—"
            }
            decision={
              round.decision_status_id
                ? approvalStatuses.find((s) => s.id === round.decision_status_id) || null
                : null
            }
          />
        ))}
      </div>
    </div>
  );
}

function RoundCard({
  documentId,
  round,
  party,
  decision,
}: {
  documentId: string;
  round: ApprovalRound;
  party: string;
  decision: ApprovalStatus | null;
}) {
  const [expanded, setExpanded] = useState(true);
  const letter = decision?.letter?.toUpperCase() || null;
  const tone = letter === "C" ? "danger" : letter ? "success" : "muted";

  return (
    <div className="rounded-md border">
      <button
        className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-accent/30"
        onClick={() => setExpanded(!expanded)}
      >
        {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium truncate">
            Approver {round.approver_order} — {party}
          </div>
          <div className="text-xs text-muted-foreground">
            {round.submitted_at ? `Submitted ${new Date(round.submitted_at).toLocaleDateString()}` : "Not submitted"}
            {round.response_date && ` · Responded ${new Date(round.response_date).toLocaleDateString()}`}
          </div>
        </div>
        {decision ? (
          <Badge
            className={
              tone === "danger" ? "bg-red-500/15 text-red-500" : "bg-emerald-500/15 text-emerald-500"
            }
          >
            {decision.letter} — {decision.name}
          </Badge>
        ) : (
          <Badge variant="outline">Awaiting response</Badge>
        )}
      </button>

      {expanded && (
        <div className="border-t px-3 py-2.5 space-y-2 text-sm">
          {round.signatory_name && (
            <div>
              <span className="text-xs text-muted-foreground">Signatory: </span>
              <span>{round.signatory_name}</span>
            </div>
          )}
          {round.comments && (
            <div className="rounded-md bg-muted/50 px-2.5 py-2 text-xs whitespace-pre-wrap">
              {round.comments}
            </div>
          )}
          {round.returned_file_name && (
            <a
              href={`/api/v1/documents/${documentId}/approval-rounds/${round.id}/file`}
              className="flex items-center gap-2 text-xs text-sky-500 hover:underline"
            >
              <FileText className="h-3.5 w-3.5" />
              {round.returned_file_name}
            </a>
          )}
          {round.remarks_file_name && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <MessageSquare className="h-3.5 w-3.5" />
              Remarks: {round.remarks_file_name}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
