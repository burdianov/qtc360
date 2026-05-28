"use client";

import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";

import api from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  documentId: string;
  approverOrder: number;
  approverName: string;
  onSuccess: () => void;
}

export function SubmitToApproverDialog({
  open,
  onOpenChange,
  documentId,
  approverOrder,
  approverName,
  onSuccess,
}: Props) {
  const today = new Date().toISOString().slice(0, 10);
  const [submittedDate, setSubmittedDate] = useState(today);

  useEffect(() => {
    if (open) setSubmittedDate(new Date().toISOString().slice(0, 10));
  }, [open]);

  const mutation = useMutation({
    mutationFn: () => api.post(`/documents/${documentId}/submit-to-approver`, {
      approver_order: approverOrder,
      submitted_at: new Date(submittedDate).toISOString(),
    }),
    onSuccess: () => {
      toast.success(`Submitted to Approver ${approverOrder}`);
      onSuccess();
      onOpenChange(false);
    },
    onError: (err: unknown) => {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      toast.error(detail || "Submission failed");
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Submit to Approver {approverOrder}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Confirm that you have uploaded this document to Aconex and transmitted it to{" "}
            <span className="font-medium text-foreground">{approverName || "the approver"}</span>.
            This records the submission in QTC360 — no file upload here.
          </p>
          <div>
            <label className="text-xs text-muted-foreground mb-1.5 block">Submission date</label>
            <Input
              type="date"
              value={submittedDate}
              onChange={(e) => setSubmittedDate(e.target.value)}
              max={today}
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button onClick={() => mutation.mutate()} disabled={mutation.isPending || !submittedDate}>
              {mutation.isPending ? "Submitting..." : "Confirm submission"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
