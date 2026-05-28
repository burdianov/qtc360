"use client";

import { useEffect, useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { Crosshair, Sparkles } from "lucide-react";

import api from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PdfRegionPicker, type PdfRegion } from "./pdf-region-picker";
import type { ApprovalStatus } from "./approval-action-panel";

type Field = "signatory_name" | "response_date" | "comments";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  documentId: string;
  approverOrder: number;
  approverName: string;
  approvalStatuses: ApprovalStatus[];
  onSuccess: () => void;
}

interface CapturedRegion {
  region: PdfRegion;
  via: "native" | "ocr";
}

export function RecordResponseDialog({
  open,
  onOpenChange,
  documentId,
  approverOrder,
  approverName,
  approvalStatuses,
  onSuccess,
}: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [decisionStatusId, setDecisionStatusId] = useState("");
  const [signatoryName, setSignatoryName] = useState("");
  const [responseDate, setResponseDate] = useState(new Date().toISOString().slice(0, 10));
  const [comments, setComments] = useState("");
  const [armedField, setArmedField] = useState<Field | null>(null);
  const [lastRegion, setLastRegion] = useState<Partial<Record<Field, CapturedRegion>>>({});
  const [extracting, setExtracting] = useState(false);

  // Sort statuses by letter so radios show A → D consistently across projects.
  const sortedStatuses = useMemo(
    () => [...approvalStatuses].sort((a, b) => a.letter.localeCompare(b.letter)),
    [approvalStatuses],
  );

  useEffect(() => {
    if (!open) {
      // Reset all state on close so reopening doesn't carry stale values.
      setFile(null);
      setDecisionStatusId("");
      setSignatoryName("");
      setComments("");
      setResponseDate(new Date().toISOString().slice(0, 10));
      setArmedField(null);
      setLastRegion({});
    }
  }, [open]);

  useEffect(() => {
    if (!file) {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const callExtract = async (region: PdfRegion, field: Field, force = false) => {
    if (!file) return null;
    // Server reads the persisted file by round_id, but we don't have a round
    // yet — extraction happens against the locally-uploaded preview file via
    // a stateless preview endpoint we add next, OR we round-trip the file in
    // the request. The simplest path: also POST the file as multipart to the
    // extract endpoint when no round_id is available. We use the existing
    // round endpoint after save instead; pre-save we use a preview endpoint.
    setExtracting(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("page", String(region.page));
      fd.append("x", String(region.x));
      fd.append("y", String(region.y));
      fd.append("width", String(region.width));
      fd.append("height", String(region.height));
      fd.append("target_field", field);
      fd.append("force_ocr", force ? "true" : "false");
      const res = await api.post(
        `/documents/${documentId}/extract-preview`,
        fd,
        { headers: { "Content-Type": "multipart/form-data" } },
      );
      const text = (res.data?.text || "") as string;
      const via = (res.data?.via || "native") as "native" | "ocr";
      if (!text.trim()) {
        toast.warning("Nothing recognized in that region. Try a tighter box or 'Try OCR instead'.");
        return null;
      }
      setLastRegion((prev) => ({ ...prev, [field]: { region, via } }));
      if (field === "signatory_name") setSignatoryName(text);
      else if (field === "response_date") setResponseDate(text);
      else setComments((c) => (c ? c + " " + text : text));
      toast.success(`Captured ${field.replace("_", " ")} via ${via === "ocr" ? "OCR" : "native text"}`);
      return text;
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      toast.error(detail || "Capture failed");
      return null;
    } finally {
      setExtracting(false);
    }
  };

  const onCapture = (region: PdfRegion) => {
    if (!armedField) return;
    const field = armedField;
    setArmedField(null);
    callExtract(region, field);
  };

  const retryAsOcr = (field: Field) => {
    const r = lastRegion[field]?.region;
    if (!r) {
      toast.error("Capture a region first");
      return;
    }
    callExtract(r, field, true);
  };

  const submitMutation = useMutation({
    mutationFn: async () => {
      if (!file || !decisionStatusId || !signatoryName || !responseDate) {
        throw new Error("missing");
      }
      const fd = new FormData();
      fd.append("file", file);
      const params = new URLSearchParams({
        approver_order: String(approverOrder),
        decision_status_id: decisionStatusId,
        signatory_name: signatoryName,
        response_date: responseDate,
      });
      if (comments) params.set("comments", comments);
      return api.post(
        `/documents/${documentId}/approval-rounds?${params.toString()}`,
        fd,
        { headers: { "Content-Type": "multipart/form-data" } },
      );
    },
    onSuccess: () => {
      toast.success(`Approver ${approverOrder} response recorded`);
      onSuccess();
      onOpenChange(false);
    },
    onError: (err: unknown) => {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      toast.error(detail || "Could not record response");
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl">
        <DialogHeader>
          <DialogTitle>
            Record Approver {approverOrder} response{approverName ? ` — ${approverName}` : ""}
          </DialogTitle>
        </DialogHeader>
        <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
          <div className="space-y-3">
            <FileInput file={file} onFile={setFile} />
            <PdfRegionPicker
              fileUrl={previewUrl}
              armed={!!armedField}
              onCapture={onCapture}
              onCancelArm={() => setArmedField(null)}
            />
          </div>
          <FormSide
            sortedStatuses={sortedStatuses}
            decisionStatusId={decisionStatusId}
            setDecisionStatusId={setDecisionStatusId}
            signatoryName={signatoryName}
            setSignatoryName={setSignatoryName}
            responseDate={responseDate}
            setResponseDate={setResponseDate}
            comments={comments}
            setComments={setComments}
            armedField={armedField}
            armField={(f) => setArmedField((prev) => (prev === f ? null : f))}
            disableArm={!file || extracting}
            retryAsOcr={retryAsOcr}
            captured={lastRegion}
          />
        </div>
        <div className="flex items-center justify-between pt-4 border-t mt-4">
          <p className="text-xs text-muted-foreground">
            File splits into cover + per-page attachments on save.
          </p>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button
              onClick={() => submitMutation.mutate()}
              disabled={
                !file || !decisionStatusId || !signatoryName || !responseDate || submitMutation.isPending
              }
            >
              {submitMutation.isPending ? "Saving..." : "Save response"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function FileInput({ file, onFile }: { file: File | null; onFile: (f: File | null) => void }) {
  return (
    <div>
      <label className="text-xs text-muted-foreground mb-1.5 block">Returned PDF</label>
      <input
        type="file"
        accept="application/pdf"
        onChange={(e) => onFile(e.target.files?.[0] || null)}
        className="block w-full text-sm file:mr-3 file:rounded-md file:border file:border-input file:bg-transparent file:px-3 file:py-1.5 file:text-sm hover:file:bg-accent"
      />
      {file && <p className="text-xs text-muted-foreground mt-1">Selected: {file.name}</p>}
    </div>
  );
}

interface FormSideProps {
  sortedStatuses: ApprovalStatus[];
  decisionStatusId: string;
  setDecisionStatusId: (v: string) => void;
  signatoryName: string;
  setSignatoryName: (v: string) => void;
  responseDate: string;
  setResponseDate: (v: string) => void;
  comments: string;
  setComments: (v: string) => void;
  armedField: Field | null;
  armField: (f: Field) => void;
  disableArm: boolean;
  retryAsOcr: (f: Field) => void;
  captured: Partial<Record<Field, CapturedRegion>>;
}

function FormSide(props: FormSideProps) {
  const {
    sortedStatuses, decisionStatusId, setDecisionStatusId,
    signatoryName, setSignatoryName,
    responseDate, setResponseDate,
    comments, setComments,
    armedField, armField, disableArm, retryAsOcr, captured,
  } = props;
  return (
    <div className="space-y-4">
      <div>
        <label className="text-xs text-muted-foreground mb-1.5 block">Decision</label>
        <div className="grid gap-1.5">
          {sortedStatuses.map((s) => (
            <label
              key={s.id}
              className={
                "flex items-start gap-2 rounded-md border px-3 py-2 cursor-pointer text-sm " +
                (decisionStatusId === s.id ? "border-foreground/40 bg-accent/40" : "hover:bg-accent/30")
              }
            >
              <input
                type="radio"
                name="decision"
                checked={decisionStatusId === s.id}
                onChange={() => setDecisionStatusId(s.id)}
                className="mt-0.5"
              />
              <div className="flex-1 min-w-0">
                <div className="font-medium">{s.letter} — {s.name}</div>
                <div className="text-xs text-muted-foreground">{s.description || s.action}</div>
              </div>
            </label>
          ))}
        </div>
      </div>
      <CaptureRow
        label="Signatory name"
        field="signatory_name"
        value={signatoryName}
        onChange={setSignatoryName}
        armed={armedField === "signatory_name"}
        armField={armField}
        disableArm={disableArm}
        retryAsOcr={retryAsOcr}
        captured={captured.signatory_name}
      />
      <CaptureRow
        label="Response date"
        field="response_date"
        value={responseDate}
        onChange={setResponseDate}
        armed={armedField === "response_date"}
        armField={armField}
        disableArm={disableArm}
        retryAsOcr={retryAsOcr}
        captured={captured.response_date}
        type="date"
      />
      <CaptureRow
        label="Comments"
        field="comments"
        value={comments}
        onChange={setComments}
        armed={armedField === "comments"}
        armField={armField}
        disableArm={disableArm}
        retryAsOcr={retryAsOcr}
        captured={captured.comments}
        textarea
      />
    </div>
  );
}

function CaptureRow({
  label, field, value, onChange, armed, armField, disableArm, retryAsOcr, captured, type, textarea,
}: {
  label: string;
  field: Field;
  value: string;
  onChange: (v: string) => void;
  armed: boolean;
  armField: (f: Field) => void;
  disableArm: boolean;
  retryAsOcr: (f: Field) => void;
  captured: CapturedRegion | undefined;
  type?: string;
  textarea?: boolean;
}) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-1.5">
        <label className="text-xs text-muted-foreground flex-1">{label}</label>
        <Button
          type="button"
          size="sm"
          variant={armed ? "default" : "outline"}
          className="h-7 px-2 text-xs"
          disabled={disableArm}
          onClick={() => armField(field)}
        >
          <Crosshair className="mr-1 h-3 w-3" />
          {armed ? "Cancel" : "Capture"}
        </Button>
        {captured && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-7 px-2 text-xs"
            onClick={() => retryAsOcr(field)}
            title="Re-extract via OCR (for flattened PDFs)"
          >
            <Sparkles className="mr-1 h-3 w-3" />
            OCR
          </Button>
        )}
      </div>
      {textarea ? (
        <Textarea value={value} onChange={(e) => onChange(e.target.value)} rows={3} />
      ) : (
        <Input type={type || "text"} value={value} onChange={(e) => onChange(e.target.value)} />
      )}
      {captured && (
        <p className="text-[11px] text-muted-foreground mt-1">
          Captured page {captured.region.page} via {captured.via === "ocr" ? "OCR" : "native text"}
        </p>
      )}
    </div>
  );
}
