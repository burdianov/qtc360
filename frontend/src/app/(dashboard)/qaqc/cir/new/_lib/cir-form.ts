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

export interface CirAsset {
  id: string;
  name: string;
  tag_number: string;
  asset_type_id: string;
}

export interface CirAssetType {
  id: string;
  name: string;
  code: string;
  service_id: string;
  parent_type_id: string | null;
}

export interface CirService {
  id: string;
  name: string;
  code: string;
  discipline_id: string;
}

// ── Zod schema ─────────────────────────────────────────────────────────────

export const cirSchema = z.object({
  subject: z.string().min(1, "Subject is required"),
  discipline_id: z.string().min(1, "Discipline is required"),
  description: z.string().min(1, "Description is required"),
  general_location: z.string().optional(),
  floor_level_room: z.string().optional(),
  approved_rams: z.string().optional(),
  drawing_reference: z.string().optional(),
  inspector_1_id: z.string().optional(),
  inspector_2_id: z.string().optional(),
  remarks_1: z.string().optional(),
  remarks_2: z.string().optional(),
  inspector_date_1: z.string().optional(),
  inspector_time_1: z.string().optional(),
  date: z.string().optional(),
});

export type CirFormValues = z.infer<typeof cirSchema>;

// ── Default values ─────────────────────────────────────────────────────────

export const cirDefaultValues: CirFormValues = {
  subject: "",
  discipline_id: "",
  description: "",
  general_location: "",
  floor_level_room: "",
  approved_rams: "",
  drawing_reference: "",
  inspector_1_id: "",
  inspector_2_id: "",
  remarks_1: "",
  remarks_2: "",
  inspector_date_1: "",
  inspector_time_1: "",
  date: new Date().toISOString().split("T")[0],
};

// ── Payload builder ────────────────────────────────────────────────────────

export function buildCirPayload(
  values: CirFormValues,
  projectId: string,
  commissioningLinkage: { flatMap: (fn: (b: any) => string[]) => string[] } | null,
  revisionOfId: string | null,
) {
  return {
    project_id: projectId,
    document_type: "CIR",
    title: values.subject,
    description: values.description,
    discipline_id: values.discipline_id,
    location: values.general_location || null,
    floor_level: values.floor_level_room || null,
    rams_ref: values.approved_rams || null,
    drawing_ref: values.drawing_reference || null,
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
