import { z } from "zod/v4";

// ── Shared interfaces ──────────────────────────────────────────────────────

export interface Discipline {
  id: string;
  name: string;
  code: string;
}

export interface InspectorUser {
  id: string;
  full_name: string;
  designation: { id: string; name: string } | null;
  signature_text: string | null;
  signature_font: string | null;
  has_signature: boolean;
}

export interface MirAsset {
  id: string;
  name: string;
  tag_number: string;
  asset_type_id: string;
}

export interface MirAssetType {
  id: string;
  name: string;
  code: string;
  service_id: string;
  parent_type_id: string | null;
}

export interface MirService {
  id: string;
  name: string;
  code: string;
  discipline_id: string;
}

// ── Zod schema ─────────────────────────────────────────────────────────────

export const mirSchema = z.object({
  subject: z.string().min(1, "Subject is required"),
  discipline_id: z.string().min(1, "Discipline is required"),
  description: z.string().min(1, "Materials description is required"),
  delivery_note: z.string().optional(),
  material_submittals: z.string().optional(),
  qty: z.string().optional(),
  location: z.string().optional(),
  inspector_1_id: z.string().optional(),
  inspector_2_id: z.string().optional(),
  remarks_1: z.string().optional(),
  remarks_2: z.string().optional(),
  inspector_date_1: z.string().min(1, "Inspection date is required"),
  inspector_time_1: z.string().optional(),
  date: z.string().min(1, "Inspection date is required"),
});

export type MirFormValues = z.infer<typeof mirSchema>;

// ── Default values ─────────────────────────────────────────────────────────

export const mirDefaultValues: MirFormValues = {
  subject: "",
  discipline_id: "",
  description: "",
  delivery_note: "",
  material_submittals: "",
  qty: "",
  location: "",
  inspector_1_id: "",
  inspector_2_id: "",
  remarks_1: "",
  remarks_2: "",
  inspector_date_1: new Date().toISOString().split("T")[0],
  inspector_time_1: "",
  date: new Date().toISOString().split("T")[0],
};

// ── Payload builder ────────────────────────────────────────────────────────

export function buildMirPayload(
  values: MirFormValues,
  projectId: string,
  commissioningLinkage: { flatMap: (fn: (b: any) => string[]) => string[] } | null,
  revisionOfId: string | null,
) {
  return {
    project_id: projectId,
    document_type: "MIR",
    title: values.subject,
    description: values.description,
    discipline_id: values.discipline_id,
    location: values.location || null,
    delivery_note: values.delivery_note || null,
    material_submittals: values.material_submittals || null,
    qty: values.qty || null,
    inspection_date: values.date || null,
    site_engineer_id: values.inspector_1_id || null,
    qaqc_engineer_id: values.inspector_2_id || null,
    remarks_1: values.remarks_1 || null,
    remarks_2: values.remarks_2 || null,
    inspector_date_1: values.inspector_date_1 || null,
    inspector_time_1: values.inspector_time_1 || null,
    asset_ids: commissioningLinkage
      ? [...new Set(commissioningLinkage.flatMap((b) => b.assetIds))]
      : [],
    ...(revisionOfId ? { revision_of_id: revisionOfId } : {}),
  };
}
