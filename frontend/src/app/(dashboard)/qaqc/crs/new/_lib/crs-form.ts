import { z } from "zod/v4";

// ── Shared interfaces ──────────────────────────────────────────────────────

export interface Discipline {
  id: string;
  name: string;
  code: string;
}

export interface SourceDoc {
  id: string;
  reference_no: string;
  title: string;
  revision_no: number;
  description: string | null;
  full_reference_no?: string;
}

export interface ApprovalRound {
  id: string;
  approver_order: number;
  comments: string | null;
  decision_status_id: string | null;
}

export interface ApprovalStatus {
  id: string;
  letter: string;
  name: string;
}

export interface CrsRow {
  sn: number;
  comment: string;
  response: string;
}

// ── Zod schema ─────────────────────────────────────────────────────────────

export const crsSchema = z.object({
  subject: z.string().min(1, "Subject is required"),
  discipline_id: z.string().min(1, "Discipline is required"),
});

export type CrsFormValues = z.infer<typeof crsSchema>;

// ── Default values ─────────────────────────────────────────────────────────

export const crsDefaultValues: CrsFormValues = {
  subject: "",
  discipline_id: "",
};

// ── Payload builder ────────────────────────────────────────────────────────

export interface CrsPayloadOptions {
  sourceDocumentId: string | null;
  sourceDocType: string | null;
  sourceApproverOrder: number | null;
  approverStatus: string;
  rows: CrsRow[];
}

export function buildCrsPayload(
  values: CrsFormValues,
  projectId: string,
  opts: CrsPayloadOptions,
) {
  return {
    project_id: projectId,
    document_type: "CRS",
    title: values.subject,
    discipline_id: values.discipline_id,
    crs_data: {
      source_document_id: opts.sourceDocumentId || null,
      source_doc_type: opts.sourceDocType || null,
      source_approver_order: opts.sourceApproverOrder,
      approver_status: opts.approverStatus,
      rows: opts.rows.map((r) => ({ ...r, status: opts.approverStatus })),
    },
  };
}
