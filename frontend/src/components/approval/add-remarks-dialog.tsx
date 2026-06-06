"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";

import api from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { ApprovalRound } from "./approval-action-panel";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  documentId: string;
  round: ApprovalRound | null;
  onSuccess: () => void;
}

export function AddRemarksDialog({ open, onOpenChange, documentId, round, onSuccess }: Props) {
  const [file, setFile] = useState<File | null>(null);

  const mutation = useMutation({
    mutationFn: async () => {
      if (!round || !file) throw new Error("missing");
      const fd = new FormData();
      fd.append("file", file);
      return api.post(
        `/documents/${documentId}/approval-rounds/${round.id}/remarks`,
        fd,
        { headers: { "Content-Type": "multipart/form-data" } },
      );
    },
    onSuccess: () => {
      toast.success("Remarks attached to Approver 1 round");
      onSuccess();
      onOpenChange(false);
      setFile(null);
    },
    onError: (err: unknown) => {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      toast.error(detail || "Could not attach remarks");
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add remarks for Approver 2</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Optional. Attach a PDF prepared elsewhere with your responses to Approver 1's
            comments. It will be bundled with the resubmittal to Approver 2.
          </p>
          <Input file={file} onFile={setFile} />
          {round?.remarks_file_name && (
            <p className="text-xs text-muted-foreground">
              Replacing existing file: <span className="font-medium">{round.remarks_file_name}</span>
            </p>
          )}
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button onClick={() => mutation.mutate()} disabled={!file || mutation.isPending} aria-busy={mutation.isPending || undefined}>
              {mutation.isPending && <Spinner size="sm" className="text-current" />}
              {mutation.isPending ? "Uploading…" : "Attach"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Input({ file, onFile }: { file: File | null; onFile: (f: File | null) => void }) {
  return (
    <div className="space-y-1">
      <label className="text-xs text-muted-foreground block">Remarks PDF</label>
      <input
        type="file"
        accept="application/pdf"
        onChange={(e) => onFile(e.target.files?.[0] || null)}
        className="block w-full text-sm file:mr-3 file:rounded-md file:border file:border-input file:bg-transparent file:px-3 file:py-1.5 file:text-sm hover:file:bg-accent"
      />
      <p className="text-xs text-muted-foreground">{file ? `Selected: ${file.name}` : "Accepted format: PDF"}</p>
    </div>
  );
}
