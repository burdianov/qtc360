"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight, FileText, MessageSquare, Download, Upload, Plus, RefreshCw } from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import api from "@/lib/api";
import { formatDate } from "@/lib/format-date";
import type { ApprovalRound, ApprovalStatus, ProjectApprover } from "./approval-action-panel";

interface Props {
  documentId: string;
  rounds: ApprovalRound[];
  projectApprovers: ProjectApprover[];
  approvalStatuses: ApprovalStatus[];
  locked?: boolean;
  onReplace?: (approverOrder: number) => void;
}

export function ApprovalRoundsList({
  documentId,
  rounds,
  projectApprovers,
  approvalStatuses,
  locked,
  onReplace,
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
            locked={locked}
            party={
              projectApprovers.find((pa) => pa.approver_order === round.approver_order)?.approver.name || "—"
            }
            decision={
              round.decision_status_id
                ? approvalStatuses.find((s) => s.id === round.decision_status_id) || null
                : null
            }
            onReplace={onReplace}
          />
        ))}
      </div>
    </div>
  );
}

function RoundCard({
  documentId,
  round,
  locked,
  party,
  decision,
  onReplace,
}: {
  documentId: string;
  round: ApprovalRound;
  locked?: boolean;
  party: string;
  decision: ApprovalStatus | null;
  onReplace?: (approverOrder: number) => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const [uploadDialogOpen, setUploadDialogOpen] = useState(false);
  const letter = decision?.letter?.toUpperCase() || null;
  const tone = letter === "C" ? "danger" : letter ? "success" : "muted";

  const handleDownloadBundle = async () => {
    try {
      const res = await api.get(`/documents/${documentId}/approval-rounds/${round.id}/bundle`, { responseType: "blob" });
      const url = URL.createObjectURL(res.data);
      const a = document.createElement("a");
      a.href = url;
      a.download = `round_${round.approver_order}_${round.round_no}_bundle.pdf`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch { toast.error("Failed to download bundle"); }
  };

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
            {round.submitted_at ? `Submitted ${formatDate(round.submitted_at)}` : "Not submitted"}
            {round.response_date && ` · Responded ${formatDate(round.response_date)}${round.response_time ? ` ${round.response_time}` : ""}`}
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
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={async () => {
                  try {
                    const res = await api.get(`/documents/${documentId}/approval-rounds/${round.id}/bundle`, { responseType: "blob" });
                    const url = URL.createObjectURL(res.data);
                    window.open(url, "_blank");
                    setTimeout(() => URL.revokeObjectURL(url), 60000);
                  } catch { toast.error("Failed to open file"); }
                }}
                className="flex items-center gap-2 text-xs text-sky-500 hover:underline"
              >
                <FileText className="h-3.5 w-3.5" />
                {round.returned_file_name}
              </button>
              <Button
                size="sm"
                variant="ghost"
                className="h-6 px-2 text-xs text-amber-600 hover:text-amber-700 hover:bg-amber-500/10"
                disabled={locked}
                onClick={() => onReplace?.(round.approver_order)}
              >
                <RefreshCw className="mr-1 h-3 w-3" />
                Replace
              </Button>
            </div>
          )}
          {round.remarks_file_name && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <MessageSquare className="h-3.5 w-3.5" />
              Remarks: {round.remarks_file_name}
            </div>
          )}
          {round.returned_file_name && (
            <div className="flex gap-2 pt-2">
              <Button
                size="sm"
                variant="outline"
                className="h-8 text-xs"
                onClick={handleDownloadBundle}
              >
                <Download className="mr-1.5 h-3.5 w-3.5" />
                Download Bundle
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-8 text-xs"
                onClick={() => setUploadDialogOpen(true)}
              >
                <Plus className="mr-1.5 h-3.5 w-3.5" />
                Add Attachment
              </Button>
            </div>
          )}
        </div>
      )}

      <UploadAttachmentDialog
        open={uploadDialogOpen}
        onOpenChange={setUploadDialogOpen}
        documentId={documentId}
        roundId={round.id}
      />
    </div>
  );
}

function UploadAttachmentDialog({
  open,
  onOpenChange,
  documentId,
  roundId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  documentId: string;
  roundId: string;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [insertAfterPage, setInsertAfterPage] = useState("0");
  const queryClient = useQueryClient();

  const uploadMutation = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error("No file selected");
      const fd = new FormData();
      fd.append("file", file);
      return api.post(
        `/documents/${documentId}/approval-rounds/${roundId}/attachments?insert_after_page=${insertAfterPage}`,
        fd,
        { headers: { "Content-Type": "multipart/form-data" } }
      );
    },
    onSuccess: () => {
      toast.success("Attachment uploaded successfully");
      queryClient.invalidateQueries({ queryKey: ["document", documentId] });
      onOpenChange(false);
      setFile(null);
      setInsertAfterPage("0");
    },
    onError: (err: unknown) => {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      toast.error(detail || "Failed to upload attachment");
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Add Attachment to Round</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <label className="text-xs text-muted-foreground mb-1.5 block">PDF File</label>
            <input
              type="file"
              accept="application/pdf"
              onChange={(e) => setFile(e.target.files?.[0] || null)}
              className="block w-full text-sm file:mr-3 file:rounded-md file:border file:border-input file:bg-transparent file:px-3 file:py-1.5 file:text-sm hover:file:bg-accent"
            />
            <p className="text-xs text-muted-foreground mt-1">{file ? `Selected: ${file.name}` : "Accepted format: PDF"}</p>
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1.5 block">
              Insert After Page (0 = after first page)
            </label>
            <Input
              type="number"
              min="0"
              value={insertAfterPage}
              onChange={(e) => setInsertAfterPage(e.target.value)}
            />
            <p className="text-xs text-muted-foreground mt-1">
              Page numbers are 0-indexed. Enter 0 to insert after the first page, 1 for after the second page, etc.
            </p>
          </div>
        </div>
        <div className="flex justify-end gap-2 pt-4 border-t">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => uploadMutation.mutate()}
            disabled={!file || uploadMutation.isPending}
          >
            {uploadMutation.isPending ? "Uploading..." : "Upload"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
