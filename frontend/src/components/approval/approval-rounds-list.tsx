"use client";

import { useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Eye,
  FileText,
  MessageSquare,
  Download,
  Plus,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import api from "@/lib/api";
import { formatDate } from "@/lib/format-date";
import { MAX_ATTACHMENT_BYTES } from "@/lib/constants";
import { BundleComposerModal } from "./bundle-composer-modal";
import { PdfPreviewModal } from "@/components/pdf-preview-modal";
import { formatSizeCap, validateFileSize } from "@/lib/upload";
import type {
  ApprovalRound,
  ApprovalStatus,
  ProjectApprover,
} from "./approval-action-panel";

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
      <h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Rounds
      </h4>
      <div className="space-y-2">
        {rounds.map((round) => (
          <RoundCard
            key={round.id}
            documentId={documentId}
            round={round}
            locked={locked}
            party={
              projectApprovers.find(
                (pa) => pa.approver_order === round.approver_order,
              )?.approver.name || "-"
            }
            decision={
              round.decision_status_id
                ? approvalStatuses.find(
                    (s) => s.id === round.decision_status_id,
                  ) || null
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
  const [expanded, setExpanded] = useState(false);
  const [uploadDialogOpen, setUploadDialogOpen] = useState(false);
  const [pdfPreviewUrl, setPdfPreviewUrl] = useState<string | null>(null);
  const letter = decision?.letter?.toUpperCase() || null;
  const tone = letter === "C" ? "danger" : letter ? "success" : "muted";

  const handleDownloadBundle = async () => {
    try {
      const res = await api.get(
        `/documents/${documentId}/approval-rounds/${round.id}/bundle`,
        { responseType: "blob" },
      );
      const disposition = res.headers["content-disposition"] || "";
      const match = disposition.match(/filename="?([^"]+)"?/);
      const filename = match?.[1] || "bundle.pdf";
      const url = URL.createObjectURL(res.data);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch {
      toast.error("Failed to download bundle");
    }
  };

  return (
    <div className="rounded-md border">
      <button
        className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-accent/30"
        onClick={() => setExpanded(!expanded)}
      >
        {expanded ? (
          <ChevronDown className="h-4 w-4 transition-transform" />
        ) : (
          <ChevronRight className="h-4 w-4 transition-transform" />
        )}
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium truncate">
            Approver {round.approver_order} - {party}
          </div>
          <div className="text-xs text-muted-foreground">
            {round.submitted_at
              ? `Submitted ${formatDate(round.submitted_at)}`
              : "Not submitted"}
            {round.response_date &&
              ` · Responded ${formatDate(round.response_date)}${round.response_time ? ` ${round.response_time}` : ""}`}
          </div>
        </div>
        {decision ? (
          <Badge
            className={
              tone === "danger"
                ? "bg-red-500/15 text-red-500"
                : "bg-emerald-500/15 text-emerald-500"
            }
          >
            {decision.letter} - {decision.name}
          </Badge>
        ) : (
          <Badge variant="outline">Awaiting response</Badge>
        )}
      </button>

      <div
        className="grid transition-[grid-template-rows] duration-200 ease-in-out"
        style={{ gridTemplateRows: expanded ? "1fr" : "0fr" }}
      >
        <div className="overflow-hidden">
          <div className="border-t px-3 py-2.5 space-y-2 text-sm">
            {round.signatory_name && (
              <div>
                <span className="text-xs text-muted-foreground">
                  Signatory:{" "}
                </span>
                <span>{round.signatory_name}</span>
              </div>
            )}
            {round.aconex_submitted_date && (
              <div>
                <span className="text-xs text-muted-foreground">
                  Aconex submitted:{" "}
                </span>
                <span className="text-xs">
                  {formatDate(round.aconex_submitted_date)}
                </span>
              </div>
            )}
            {round.aconex_received_date && (
              <div>
                <span className="text-xs text-muted-foreground">
                  Aconex received:{" "}
                </span>
                <span className="text-xs">
                  {formatDate(round.aconex_received_date)}
                </span>
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
                      const res = await api.get(
                        `/documents/${documentId}/approval-rounds/${round.id}/bundle`,
                        { responseType: "blob" },
                      );
                      const url = URL.createObjectURL(res.data);
                      setPdfPreviewUrl(url);
                    } catch {
                      toast.error("Failed to open file");
                    }
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
                  onClick={async () => {
                    try {
                      const res = await api.get(
                        `/documents/${documentId}/approval-rounds/${round.id}/bundle`,
                        { responseType: "blob" },
                      );
                      const url = URL.createObjectURL(res.data);
                      setPdfPreviewUrl(url);
                    } catch {
                      toast.error("Failed to preview PDF");
                    }
                  }}
                >
                  <Eye className="mr-1.5 h-3.5 w-3.5" />
                  Preview
                </Button>
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
                  Upload Attachment
                </Button>
              </div>
            )}
            <RoundAttachmentsList
              documentId={documentId}
              roundId={round.id}
              locked={locked}
            />
          </div>
        </div>
      </div>

      <UploadAttachmentDialog
        open={uploadDialogOpen}
        onOpenChange={setUploadDialogOpen}
        documentId={documentId}
        roundId={round.id}
      />
      <PdfPreviewModal open={!!pdfPreviewUrl} onOpenChange={(o) => { if (!o) { if (pdfPreviewUrl) URL.revokeObjectURL(pdfPreviewUrl); setPdfPreviewUrl(null); } }} pdfUrl={pdfPreviewUrl} title="Bundle Preview" />
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
  const queryClient = useQueryClient();

  const uploadMutation = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error("No file selected");
      const fd = new FormData();
      fd.append("file", file);
      return api.post(
        `/documents/${documentId}/approval-rounds/${roundId}/attachments`,
        fd,
      );
    },
    onSuccess: () => {
      toast.success("Attachment uploaded");
      queryClient.invalidateQueries({
        queryKey: ["round-attachments", roundId],
      });
      onOpenChange(false);
      setFile(null);
    },
    onError: (err: unknown) => {
      const detail = (err as { response?: { data?: { detail?: string } } })
        ?.response?.data?.detail;
      toast.error(detail || "Failed to upload attachment");
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Upload Attachment</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <label className="text-xs text-muted-foreground mb-1.5 block">
              PDF File
            </label>
            <input
              type="file"
              accept="application/pdf,image/png,image/jpeg"
              onChange={(e) => {
                const f = e.target.files?.[0] || null;
                if (f && !validateFileSize(f, MAX_ATTACHMENT_BYTES, "Attachment")) {
                  e.target.value = "";
                  return;
                }
                setFile(f);
              }}
              className="block w-full text-sm file:mr-3 file:rounded-md file:border file:border-input file:bg-transparent file:px-3 file:py-1.5 file:text-sm hover:file:bg-accent"
            />
            <p className="text-xs text-muted-foreground mt-1">
              {file
                ? `Selected: ${file.name}`
                : `Accepted formats: PDF, PNG, JPG. Max ${formatSizeCap(MAX_ATTACHMENT_BYTES)}.`}
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
            aria-busy={uploadMutation.isPending || undefined}
          >
            {uploadMutation.isPending && <Spinner size="sm" className="text-current" />}
            {uploadMutation.isPending ? "Uploading…" : "Upload"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

interface RoundAttachment {
  id: string;
  filename: string;
  size: number;
  insert_after_page: number | null;
}

function RoundAttachmentsList({
  documentId,
  roundId,
  locked,
}: {
  documentId: string;
  roundId: string;
  locked?: boolean;
}) {
  const queryClient = useQueryClient();
  const [pageModalAtt, setPageModalAtt] = useState<RoundAttachment | null>(
    null,
  );
  const [deleteTarget, setDeleteTarget] = useState<RoundAttachment | null>(
    null,
  );

  const { data: attachments = [] } = useQuery<RoundAttachment[]>({
    queryKey: ["round-attachments", roundId],
    queryFn: async () =>
      (
        await api.get(
          `/documents/${documentId}/approval-rounds/${roundId}/attachments`,
        )
      ).data,
  });

  const patchMutation = useMutation({
    mutationFn: async ({
      attId,
      insertAfterPage,
    }: {
      attId: string;
      insertAfterPage: number | null;
    }) =>
      api.patch(
        `/documents/${documentId}/approval-rounds/${roundId}/attachments/${attId}`,
        { insert_after_page: insertAfterPage },
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["round-attachments", roundId],
      });
      setPageModalAtt(null);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (attId: string) =>
      api.delete(
        `/documents/${documentId}/approval-rounds/${roundId}/attachments/${attId}`,
      ),
    onSuccess: () => {
      toast.success("Attachment deleted");
      queryClient.invalidateQueries({
        queryKey: ["round-attachments", roundId],
      });
    },
    onError: (err: unknown) => {
      const detail = (err as { response?: { data?: { detail?: string } } })
        ?.response?.data?.detail;
      toast.error(detail || "Failed to delete");
    },
  });

  if (attachments.length === 0) return null;

  return (
    <>
      <div className="space-y-1.5 pt-1">
        <p className="text-xs font-medium text-muted-foreground">Attachments</p>
        {attachments.map((att) => {
          const inBundle = att.insert_after_page !== null;
          return (
            <div
              key={att.id}
              className="flex items-center gap-2 text-xs rounded-md border px-2 py-1.5"
            >
              <FileText className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              <span className="flex-1 truncate">{att.filename}</span>
              {inBundle && (
                <span className="text-muted-foreground shrink-0">
                  after p.{att.insert_after_page! + 1}
                </span>
              )}
              {!locked && (
                <>
                  {inBundle ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 px-1.5 text-[11px] text-amber-600 hover:text-amber-700"
                      onClick={() =>
                        patchMutation.mutate({
                          attId: att.id,
                          insertAfterPage: null,
                        })
                      }
                    >
                      Remove from Bundle
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 px-1.5 text-[11px] text-emerald-600 hover:text-emerald-700"
                      onClick={() => {
                        setPageModalAtt(att);
                      }}
                    >
                      Add to Bundle
                    </Button>
                  )}
                  {!inBundle && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 px-1.5 text-[11px] text-destructive"
                      onClick={() => setDeleteTarget(att)}
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  )}
                </>
              )}
            </div>
          );
        })}
      </div>

      <BundleComposerModal
        open={!!pageModalAtt}
        onOpenChange={(open) => { if (!open) setPageModalAtt(null); }}
        documentId={documentId}
        attachments={pageModalAtt ? [{ id: pageModalAtt.id, name: pageModalAtt.filename, size: pageModalAtt.size, kind: "user" }] : []}
        title="Position Attachment in Bundle"
        onComposed={() => {
          queryClient.invalidateQueries({ queryKey: ["round-attachments", roundId] });
          setPageModalAtt(null);
        }}
      />

      <Dialog
        open={!!deleteTarget}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete Attachment</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Are you sure you want to delete &ldquo;{deleteTarget?.filename}
            &rdquo;? This cannot be undone.
          </p>
          <div className="flex justify-end gap-2 pt-3 border-t">
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={deleteMutation.isPending}
              onClick={() => {
                deleteMutation.mutate(deleteTarget!.id);
                setDeleteTarget(null);
              }}
            >
              Delete
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
