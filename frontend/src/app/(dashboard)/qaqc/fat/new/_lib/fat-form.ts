import { z } from "zod/v4";

// ── Shared interfaces ──────────────────────────────────────────────────────

export interface Discipline {
  id: string;
  name: string;
  code: string;
}

export interface FatAssetType {
  id: string;
  name: string;
  code: string;
  service_id: string;
  parent_type_id: string | null;
}

export interface FatAsset {
  id: string;
  name: string;
  tag_number: string;
  asset_type_id: string;
}

// ── Zod schema ─────────────────────────────────────────────────────────────

export const fatSchema = z.object({
  reference_no: z.string().optional(),
  description: z.string().optional(),
  discipline_id: z.string().min(1, "Discipline is required"),
});

export type FatFormValues = z.infer<typeof fatSchema>;

// ── Default values ─────────────────────────────────────────────────────────

export const fatDefaultValues: FatFormValues = {
  reference_no: "",
  description: "",
  discipline_id: "",
};

// ── Payload builder ────────────────────────────────────────────────────────

export function buildFatPayload(
  values: FatFormValues,
  projectId: string,
  assetIds: string[],
  assetNameFallback: string | null,
) {
  return {
    project_id: projectId,
    document_type: "FAT",
    title: assetNameFallback || "Factory Acceptance Test",
    description: values.description || null,
    discipline_id: values.discipline_id,
    asset_ids: assetIds,
  };
}
