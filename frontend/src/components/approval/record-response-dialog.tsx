"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertCircle, CheckCircle2, Crosshair, FileText, Paperclip, Sparkles, Upload, X } from "lucide-react";

import api from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { DatePicker } from "@/components/ui/date-picker";
import { TimePicker } from "@/components/ui/time-picker";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { PdfRegionPicker, type PdfRegion, type PdfPickerHandle } from "./pdf-region-picker";
import type { ApprovalStatus } from "./approval-action-panel";
import { MAX_ATTACHMENT_BYTES } from "@/lib/constants";
import { formatSizeCap, validateFileSize } from "@/lib/upload";

type Field = "signatory_name" | "response_date" | "response_time" | "comments";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  documentId: string;
  approverOrder: number;
  approverName: string;
  approvalStatuses: ApprovalStatus[];
  roundId?: string;
  onSuccess: () => void;
}

interface CapturedRegion {
  region: PdfRegion;
  via: "native" | "ocr";
}

/** Normalize captured time text to HH:mm (24h) for the TimePicker. Handles "2:30 PM", "14:30", "2:30PM", etc. */
function normalizeTime(raw: string): string {
  const cleaned = raw.trim().replace(/\s+/g, " ");
  const m = cleaned.match(/(\d{1,2})[:\.](\d{2})\s*(am|pm|AM|PM)?/i);
  if (!m) return cleaned;
  let h = parseInt(m[1], 10);
  const min = m[2];
  const period = (m[3] || "").toUpperCase();
  if (period === "PM" && h < 12) h += 12;
  if (period === "AM" && h === 12) h = 0;
  return `${String(h).padStart(2, "0")}:${min}`;
}

const REQUIRED_FIELDS: { key: Field | "decision_status_id" | "aconex_received_date"; label: string }[] = [
  { key: "decision_status_id", label: "Approval Status" },
  { key: "signatory_name", label: "Signatory name" },
  { key: "response_date", label: "Response date" },
  { key: "aconex_received_date", label: "Aconex received date" },
  { key: "comments", label: "Comments" },
];

export function RecordResponseDialog({
  open,
  onOpenChange,
  documentId,
  approverOrder,
  approverName,
  approvalStatuses,
  roundId,
  onSuccess,
}: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [decisionStatusId, setDecisionStatusId] = useState("");
  const [signatoryName, setSignatoryName] = useState("");
  const [responseDate, setResponseDate] = useState(
    new Date().toISOString().slice(0, 10),
  );
  const [responseTime, setResponseTime] = useState("");
  const [comments, setComments] = useState("");
  const [noComments, setNoComments] = useState(false);
  const [aconexReceivedDate, setAconexReceivedDate] = useState("");
  const [aconexReferenceNumber, setAconexReferenceNumber] = useState("");
  const [armedField, setArmedField] = useState<Field | null>(null);
  const [lastRegion, setLastRegion] = useState<
    Partial<Record<Field, CapturedRegion>>
  >({});
  const [extracting, setExtracting] = useState(false);
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const pickerRef = useRef<PdfPickerHandle>(null);
  const [pickerState, setPickerState] = useState({ zoom: 1, visiblePage: 1, numPages: 0, canZoomIn: false, canZoomOut: false });

  // Reset all fields when dialog opens
  useEffect(() => {
    if (open) {
      setFile(null);
      setPreviewUrl(null);
      setDecisionStatusId("");
      setSignatoryName("");
      setResponseDate(new Date().toISOString().slice(0, 10));
      setResponseTime("");
      setComments("");
      setNoComments(false);
      setAconexReceivedDate("");
      setAconexReferenceNumber("");
      setArmedField(null);
      setLastRegion({});
      setSubmitAttempted(false);
    }
  }, [open]);

  // Sort statuses by letter so radios show A → D consistently across projects.
  const sortedStatuses = useMemo(
    () =>
      [...approvalStatuses].sort((a, b) => a.letter.localeCompare(b.letter)),
    [approvalStatuses],
  );

  useEffect(() => {
    if (!file) {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  // Poll picker state for bottom bar controls
  useEffect(() => {
    if (!open || !pickerRef.current) return;
    const id = setInterval(() => {
      if (pickerRef.current) setPickerState(pickerRef.current.getState());
    }, 200);
    return () => clearInterval(id);
  }, [open, file]);

  // Esc cancels an armed capture; Esc with nothing armed closes the dialog (default).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && armedField) {
        e.stopPropagation();
        setArmedField(null);
      }
    };
    window.addEventListener("keydown", onKey, { capture: true });
    return () => window.removeEventListener("keydown", onKey, { capture: true } as EventListenerOptions);
  }, [open, armedField]);

  const callExtract = async (
    region: PdfRegion,
    field: Field,
    force = false,
  ) => {
    if (!file) return null;
    setExtracting(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const params = new URLSearchParams({
        page: String(region.page),
        x: String(region.x),
        y: String(region.y),
        width: String(region.width),
        height: String(region.height),
        target_field: field,
        force_ocr: force ? "true" : "false",
      });
      const res = await api.post(
        `/documents/${documentId}/extract-preview?${params.toString()}`,
        fd,
        { headers: { "Content-Type": "multipart/form-data" } },
      );
      const text = (res.data?.text || "") as string;
      const via = (res.data?.via || "native") as "native" | "ocr";
      if (!text.trim()) {
        toast.warning(
          "Nothing recognized in that region. Try a tighter box or 'Try OCR instead'.",
        );
        return null;
      }
      setLastRegion((prev) => ({ ...prev, [field]: { region, via } }));
      if (field === "signatory_name") setSignatoryName(text);
      else if (field === "response_date") setResponseDate(text);
      else if (field === "response_time") setResponseTime(normalizeTime(text));
      else setComments(text);
      toast.success(
        `Captured ${field.replace("_", " ")} via ${via === "ocr" ? "OCR" : "native text"}`,
      );
      return text;
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: unknown } } })
        ?.response?.data?.detail;
      const msg =
        typeof detail === "string"
          ? detail
          : Array.isArray(detail)
            ? detail.map((d: any) => d.msg).join(", ")
            : "Capture failed";
      toast.error(msg);
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

  // ---- Validation ----
  const fieldState = {
    decision_status_id: !!decisionStatusId,
    signatory_name: !!signatoryName.trim(),
    response_date: !!responseDate,
    aconex_received_date: !!aconexReceivedDate,
    comments: noComments || !!comments.trim(),
  } as const;

  const missingRequired = REQUIRED_FIELDS
    .filter((f) => !fieldState[f.key as keyof typeof fieldState])
    .map((f) => f.label);

  const allRequiredMet = missingRequired.length === 0;
  const isValid = !!file && allRequiredMet;
  const completedCount = REQUIRED_FIELDS.length - missingRequired.length;
  const progressPct = Math.round(
    (completedCount / REQUIRED_FIELDS.length) * 100,
  );

  const submitMutation = useMutation({
    mutationFn: async () => {
      if (!isValid || !file) {
        throw new Error("Please complete all required fields.");
      }
      const fd = new FormData();
      fd.append("file", file);

      if (roundId) {
        if (signatoryName) fd.append("signatory_name", signatoryName);
        if (responseDate) fd.append("response_date", responseDate);
        if (responseTime) fd.append("response_time", responseTime);
        if (comments) fd.append("comments", comments);
        return api.put(
          `/documents/${documentId}/approval-rounds/${roundId}/file`,
          fd,
        );
      }

      const params = new URLSearchParams({
        approver_order: String(approverOrder),
        decision_status_id: decisionStatusId,
        signatory_name: signatoryName,
        response_date: responseDate,
      });
      if (responseTime) params.set("response_time", responseTime);
      if (comments) params.set("comments", comments);
      if (aconexReceivedDate)
        params.set("aconex_received_date", aconexReceivedDate);
      if (aconexReferenceNumber)
        params.set("aconex_reference_number", aconexReferenceNumber);
      return api.post(
        `/documents/${documentId}/approval-rounds?${params.toString()}`,
        fd,
      );
    },
    onSuccess: () => {
      toast.success(
        roundId
          ? "Document replaced"
          : `Approver ${approverOrder} response recorded`,
      );
      onSuccess();
      onOpenChange(false);
    },
    onError: (err: unknown) => {
      const detail = (err as { response?: { data?: { detail?: string } } })
        ?.response?.data?.detail;
      toast.error(detail || "Could not record response");
    },
  });

  const onSave = () => {
    setSubmitAttempted(true);
    if (!isValid) {
      // Scroll the form to the first missing field, if any.
      const firstMissing = REQUIRED_FIELDS.find(
        (f) => !fieldState[f.key as keyof typeof fieldState],
      )?.key as keyof typeof fieldState | undefined;
      if (firstMissing) {
        const el = document.querySelector<HTMLElement>(
          `[data-field="${firstMissing}"]`,
        );
        el?.scrollIntoView({ behavior: "smooth", block: "center" });
        const focusable = el?.querySelector<HTMLElement>(
          "input, textarea, button, [role=radio]",
        );
        focusable?.focus();
      }
      return;
    }
    submitMutation.mutate();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        size="wide"
        className="w-full h-[90vh] sm:h-[88vh] p-0 gap-0 flex flex-col overflow-hidden"
      >
        <DialogHeader className="px-5 py-3 border-b shrink-0">
          <div className="flex items-start justify-between gap-4 pr-8">
            <div className="min-w-0">
              <DialogTitle className="text-base">
                Record Approver {approverOrder} response
                {approverName ? (
                  <span className="text-muted-foreground font-normal">
                    {" — "}
                    {approverName}
                  </span>
                ) : null}
              </DialogTitle>
              <p className="text-xs text-muted-foreground mt-1">
                Upload the returned PDF, drag regions onto the preview to capture values, then save.
              </p>
            </div>
            <div className="shrink-0 mt-0.5">
              <ProgressPill
                completed={completedCount}
                total={REQUIRED_FIELDS.length}
                pct={progressPct}
              />
            </div>
          </div>
        </DialogHeader>

        <div className="flex flex-col lg:flex-row gap-0 flex-1 min-h-0">
          {/* PDF column */}
          <div className="flex flex-col gap-2 p-4 min-h-0 min-w-0 flex-1 lg:flex-[1_1_0] border-b lg:border-b-0 lg:border-r overflow-hidden">
            <FileChip
              file={file}
              onPick={() => fileInputRef.current?.click()}
              onClear={() => setFile(null)}
              onPickFile={(f) => {
                if (f && !validateFileSize(f, MAX_ATTACHMENT_BYTES, "Returned PDF")) {
                  return;
                }
                setFile(f);
              }}
              inputRef={fileInputRef}
            />
            <div className="flex-1 min-h-0">
              <PdfRegionPicker
                ref={pickerRef}
                fileUrl={previewUrl}
                armed={!!armedField}
                onCapture={onCapture}
                onCancelArm={() => setArmedField(null)}
              />
            </div>
          </div>

          {/* Form column */}
          <div className="flex flex-col min-h-0 min-w-0 w-full lg:w-[360px] lg:shrink-0 lg:max-w-[40vw] border-t lg:border-t-0">
            {submitAttempted && !allRequiredMet ? (
              <ValidationSummary missing={missingRequired} />
            ) : null}
            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
              <FormSide
                sortedStatuses={sortedStatuses}
                decisionStatusId={decisionStatusId}
                setDecisionStatusId={setDecisionStatusId}
                signatoryName={signatoryName}
                setSignatoryName={setSignatoryName}
                responseDate={responseDate}
                setResponseDate={setResponseDate}
                responseTime={responseTime}
                setResponseTime={setResponseTime}
                aconexReceivedDate={aconexReceivedDate}
                setAconexReceivedDate={setAconexReceivedDate}
                aconexReferenceNumber={aconexReferenceNumber}
                setAconexReferenceNumber={setAconexReferenceNumber}
                comments={comments}
                setComments={setComments}
                noComments={noComments}
                setNoComments={setNoComments}
                armedField={armedField}
                armField={(f) =>
                  setArmedField((prev) => (prev === f ? null : f))
                }
                disableArm={!file || extracting}
                retryAsOcr={retryAsOcr}
                captured={lastRegion}
                submitAttempted={submitAttempted}
              />
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3 px-5 py-2.5 border-t bg-muted/30 shrink-0">
          {/* PDF viewer controls */}
          {file && (
            <div className="flex items-center gap-1.5">
              <div className="flex items-center gap-0.5 rounded-md border bg-background px-1 py-0.5">
                <Button type="button" size="icon-sm" variant="ghost" onClick={() => pickerRef.current?.zoomOut()} disabled={!pickerState.canZoomOut}>-</Button>
                <button type="button" className="text-xs tabular-nums text-muted-foreground px-1 min-w-9 text-center hover:text-foreground" onClick={() => pickerRef.current?.resetZoom()}>
                  {Math.round(pickerState.zoom * 100)}%
                </button>
                <Button type="button" size="icon-sm" variant="ghost" onClick={() => pickerRef.current?.zoomIn()} disabled={!pickerState.canZoomIn}>+</Button>
              </div>
              {pickerState.numPages > 1 && (
                <div className="flex items-center gap-0.5 rounded-md border bg-background px-1 py-0.5">
                  <Button type="button" size="icon-sm" variant="ghost" disabled={pickerState.visiblePage <= 1} onClick={() => pickerRef.current?.goPrev()}>‹</Button>
                  <input
                    type="number"
                    min={1}
                    max={pickerState.numPages}
                    value={pickerState.visiblePage}
                    onChange={(e) => { const p = parseInt(e.target.value, 10); if (p >= 1 && p <= pickerState.numPages) pickerRef.current?.goToPage(p); }}
                    className="w-7 h-5 text-center text-xs tabular-nums bg-transparent border-none outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none"
                  />
                  <span className="text-[11px] text-muted-foreground">/ {pickerState.numPages}</span>
                  <Button type="button" size="icon-sm" variant="ghost" disabled={pickerState.visiblePage >= pickerState.numPages} onClick={() => pickerRef.current?.goNext()}>›</Button>
                </div>
              )}
            </div>
          )}
          <div className="flex items-center gap-2 ml-auto">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              onClick={onSave}
              disabled={submitMutation.isPending}
              aria-busy={submitMutation.isPending || undefined}
            >
              {submitMutation.isPending && (
                <Spinner size="sm" className="mr-1 text-current" />
              )}
              {submitMutation.isPending ? "Saving…" : "Save response"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ProgressPill({
  completed,
  total,
  pct,
}: {
  completed: number;
  total: number;
  pct: number;
}) {
  const allDone = completed === total;
  return (
    <div
      className={cn(
        "inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-xs font-medium",
        allDone
          ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
          : "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300",
      )}
      role="status"
      aria-live="polite"
    >
      {allDone ? (
        <CheckCircle2 className="h-3.5 w-3.5" />
      ) : (
        <AlertCircle className="h-3.5 w-3.5" />
      )}
      <span className="tabular-nums">
        {completed}/{total} required
      </span>
      <span className="h-1 w-10 rounded-full bg-current/20 overflow-hidden">
        <span
          className="block h-full bg-current"
          style={{ width: `${pct}%` }}
        />
      </span>
    </div>
  );
}

function ValidationSummary({ missing }: { missing: string[] }) {
  return (
    <div
      role="alert"
      aria-live="assertive"
      className="mx-5 mt-3 flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive"
    >
      <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
      <div>
        <p className="font-medium">
          {missing.length} required field{missing.length === 1 ? "" : "s"} still
          need{missing.length === 1 ? "s" : ""} to be filled
        </p>
        <p className="text-destructive/80 mt-0.5">{missing.join(" • ")}</p>
      </div>
    </div>
  );
}

function FileChip({
  file,
  onPick,
  onClear,
  onPickFile,
  inputRef,
}: {
  file: File | null;
  onPick: () => void;
  onClear: () => void;
  onPickFile: (f: File | null) => void;
  inputRef: React.RefObject<HTMLInputElement | null>;
}) {
  return (
    <div className="flex items-center gap-2">
      <input
        ref={inputRef}
        type="file"
        accept="application/pdf"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0] || null;
          // Always reset the input so picking the same file twice fires onChange.
          e.target.value = "";
          onPickFile(f);
        }}
      />
      {file ? (
        <div className="flex items-center gap-2 rounded-md border bg-muted/30 pl-2.5 pr-1 py-1 text-xs min-w-0 max-w-md">
          <FileText className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          <span className="truncate" title={file.name}>
            {file.name}
          </span>
          <span className="text-muted-foreground shrink-0">
            ({formatSize(file.size)})
          </span>
          <div className="ml-auto flex items-center gap-0.5 shrink-0">
            <Button
              type="button"
              size="xs"
              variant="ghost"
              onClick={onPick}
              aria-label="Replace PDF"
            >
              <Upload className="h-3 w-3" />
              Replace
            </Button>
            <Button
              type="button"
              size="icon-xs"
              variant="ghost"
              onClick={onClear}
              aria-label="Remove PDF"
            >
              <X className="h-3 w-3" />
            </Button>
          </div>
        </div>
      ) : (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onPick}
          className="text-xs"
        >
          <Paperclip className="h-3.5 w-3.5 mr-1.5" />
          Choose returned PDF
        </Button>
      )}
      <span className="text-[11px] text-muted-foreground">
        PDF, max {formatSizeCap(MAX_ATTACHMENT_BYTES)}
      </span>
    </div>
  );
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

interface FormSideProps {
  sortedStatuses: ApprovalStatus[];
  decisionStatusId: string;
  setDecisionStatusId: (v: string) => void;
  signatoryName: string;
  setSignatoryName: (v: string) => void;
  responseDate: string;
  setResponseDate: (v: string) => void;
  responseTime: string;
  setResponseTime: (v: string) => void;
  aconexReceivedDate: string;
  setAconexReceivedDate: (v: string) => void;
  aconexReferenceNumber: string;
  setAconexReferenceNumber: (v: string) => void;
  comments: string;
  setComments: (v: string) => void;
  noComments: boolean;
  setNoComments: (v: boolean) => void;
  armedField: Field | null;
  armField: (f: Field) => void;
  disableArm: boolean;
  retryAsOcr: (f: Field) => void;
  captured: Partial<Record<Field, CapturedRegion>>;
  submitAttempted: boolean;
}

function FormSide(props: FormSideProps) {
  const {
    sortedStatuses,
    decisionStatusId,
    setDecisionStatusId,
    signatoryName,
    setSignatoryName,
    responseDate,
    setResponseDate,
    responseTime,
    setResponseTime,
    aconexReceivedDate,
    setAconexReceivedDate,
    aconexReferenceNumber,
    setAconexReferenceNumber,
    comments,
    setComments,
    noComments,
    setNoComments,
    armedField,
    armField,
    disableArm,
    retryAsOcr,
    captured,
    submitAttempted,
  } = props;

  const showStatusError = submitAttempted && !decisionStatusId;
  const showSignatoryError = submitAttempted && !signatoryName.trim();
  const showResponseDateError = submitAttempted && !responseDate;
  const showAconexError = submitAttempted && !aconexReceivedDate;

  return (
    <div className="space-y-5">
      <Section title="Decision" subtitle="Required">
        <div data-field="decision_status_id" className="space-y-1.5">
          <Label required invalid={showStatusError}>
            Approval Status
          </Label>
          <div
            role="radiogroup"
            aria-required="true"
            aria-invalid={showStatusError || undefined}
            aria-describedby={
              showStatusError ? "approval-status-error" : undefined
            }
            className="grid gap-1.5"
          >
            {sortedStatuses.map((s) => {
              const selected = decisionStatusId === s.id;
              return (
                <label
                  key={s.id}
                  className={cn(
                    "flex items-start gap-2.5 rounded-md border px-3 py-2 text-sm cursor-pointer transition-colors",
                    selected
                      ? "border-primary/60 bg-primary/5 ring-1 ring-primary/20"
                      : "hover:bg-muted/40",
                    showStatusError && "border-destructive/60",
                  )}
                >
                  <input
                    type="radio"
                    name="decision"
                    role="radio"
                    aria-checked={selected}
                    checked={selected}
                    onChange={() => setDecisionStatusId(s.id)}
                    className="mt-0.5 accent-primary"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="font-medium leading-tight">
                      <span className="inline-block w-5 text-muted-foreground tabular-nums">
                        {s.letter}.
                      </span>
                      {s.name}
                    </div>
                    {(s.description || s.action) && (
                      <div className="text-xs text-muted-foreground leading-snug mt-0.5">
                        {s.description || s.action}
                      </div>
                    )}
                  </div>
                </label>
              );
            })}
          </div>
          {showStatusError && (
            <p
              id="approval-status-error"
              className="text-xs text-destructive mt-1"
            >
              Approval Status is required.
            </p>
          )}
        </div>
      </Section>

      <Section title="Signatory" subtitle="Required">
        <div data-field="signatory_name" className="space-y-1.5">
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
            required
            invalid={showSignatoryError}
            error={showSignatoryError ? "Signatory name is required." : undefined}
          />
        </div>
      </Section>

      <Section title="Response date" subtitle="Required">
        <div data-field="response_date" className="space-y-1.5">
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
            kind="date"
            required
            invalid={showResponseDateError}
            error={
              showResponseDateError ? "Response date is required." : undefined
            }
          />
        </div>
      </Section>

      <Section title="Response time" subtitle="Optional">
        <div data-field="response_time" className="space-y-1.5">
          <CaptureRow
            label="Response time"
            field="response_time"
            value={responseTime}
            onChange={setResponseTime}
            armed={armedField === "response_time"}
            armField={armField}
            disableArm={disableArm}
            retryAsOcr={retryAsOcr}
            captured={captured.response_time}
            kind="time"
          />
        </div>
      </Section>

      <Section title="Aconex received date" subtitle="Required">
        <div data-field="aconex_received_date" className="space-y-1.5">
          <Label required invalid={showAconexError}>
            Aconex received date
          </Label>
          <DatePicker
            value={aconexReceivedDate}
            onChange={setAconexReceivedDate}
            placeholder="Select date"
            invalid={showAconexError}
          />
          {showAconexError && (
            <p className="text-xs text-destructive">
              Aconex received date is required.
            </p>
          )}
        </div>
      </Section>

      <Section title="Aconex Reference Number" subtitle="Optional">
        <div data-field="aconex_reference_number" className="space-y-1.5">
          <Input
            type="text"
            value={aconexReferenceNumber}
            onChange={(e) => setAconexReferenceNumber(e.target.value)}
            placeholder="Enter reference number"
          />
        </div>
      </Section>

      <Section title="Comments" subtitle="Required">
        <div data-field="comments" className="space-y-3">
          <label className="flex items-center gap-2 cursor-pointer">
            <Checkbox
              checked={noComments}
              onCheckedChange={(checked) => {
                const isChecked = checked === true;
                setNoComments(isChecked);
                if (isChecked) {
                  setComments("No comments");
                } else {
                  setComments("");
                }
              }}
            />
            <span className="text-xs font-medium text-muted-foreground">
              No comments
            </span>
          </label>
          <CaptureRow
            label="Comments"
            field="comments"
            value={comments}
            onChange={setComments}
            armed={armedField === "comments"}
            armField={armField}
            disableArm={disableArm || noComments}
            retryAsOcr={retryAsOcr}
            captured={captured.comments}
            kind="textarea"
            textareaDisabled={noComments}
            required
            invalid={submitAttempted && !noComments && !comments.trim()}
            error={
              submitAttempted && !noComments && !comments.trim()
                ? "Comments are required or check 'No comments'."
                : undefined
            }
          />
        </div>
      </Section>
    </div>
  );
}

function Section({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-2">
      <div className="flex items-baseline justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {title}
        </h3>
        {subtitle && (
          <span
            className={cn(
              "text-[10px] uppercase tracking-wide font-medium",
              subtitle.toLowerCase() === "required"
                ? "text-destructive/80"
                : "text-muted-foreground/70",
            )}
          >
            {subtitle}
          </span>
        )}
      </div>
      {children}
    </section>
  );
}

function Label({
  children,
  required,
  invalid,
}: {
  children: React.ReactNode;
  required?: boolean;
  invalid?: boolean;
}) {
  return (
    <label
      className={cn(
        "text-xs font-medium block",
        invalid ? "text-destructive" : "text-foreground/80",
      )}
    >
      {children}
      {required && <span className="text-destructive ml-0.5">*</span>}
    </label>
  );
}

function CaptureRow({
  label,
  field,
  value,
  onChange,
  armed,
  armField,
  disableArm,
  retryAsOcr,
  captured,
  kind = "text",
  required,
  invalid,
  error,
  textareaDisabled,
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
  kind?: "text" | "date" | "time" | "textarea";
  required?: boolean;
  invalid?: boolean;
  error?: string;
  textareaDisabled?: boolean;
}) {
  return (
    <div>
      <div className="flex items-center gap-1.5 mb-1.5">
        <Label required={required} invalid={invalid}>
          {label}
        </Label>
        <div className="ml-auto flex items-center gap-1">
          {captured && (
            <Button
              type="button"
              size="xs"
              variant="outline"
              onClick={() => retryAsOcr(field)}
              title="Re-extract via OCR (for flattened PDFs)"
            >
              <Sparkles className="h-3 w-3" />
              OCR
            </Button>
          )}
          <Button
            type="button"
            size="xs"
            variant={armed ? "default" : "outline"}
            disabled={disableArm}
            onClick={() => armField(field)}
            aria-pressed={armed}
          >
            <Crosshair className="h-3 w-3" />
            {armed ? "Cancel" : "Capture"}
          </Button>
        </div>
      </div>
      {kind === "textarea" ? (
        <Textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          rows={3}
          disabled={textareaDisabled}
          aria-invalid={invalid || undefined}
        />
      ) : kind === "date" ? (
        <DatePicker
          value={value}
          onChange={onChange}
          placeholder="Select date"
          invalid={invalid}
        />
      ) : kind === "time" ? (
        <TimePicker
          value={value}
          onChange={onChange}
          placeholder="Select time"
        />
      ) : (
        <Input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-invalid={invalid || undefined}
        />
      )}
      {error && <p className="text-xs text-destructive mt-1">{error}</p>}
      {captured && !error && (
        <p className="text-[11px] text-muted-foreground mt-1">
          Captured from page {captured.region.page} via{" "}
          {captured.via === "ocr" ? "OCR" : "native text"}
        </p>
      )}
    </div>
  );
}
