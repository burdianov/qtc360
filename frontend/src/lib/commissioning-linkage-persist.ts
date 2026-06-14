import type {
  CommissioningLinkage,
  CommissioningLinkageBlock,
} from "@/components/commissioning-linkage";
import api from "@/lib/api";
import { toast } from "sonner";

interface CommissioningLinkagePersistDeps {
  /** React state setter for commissioning linkage blocks */
  setCommissioningLinkage: (
    updater:
      | CommissioningLinkage
      | null
      | ((
          prev: CommissioningLinkage | null,
        ) => CommissioningLinkage | null),
  ) => void;
}

/**
 * Persist commissioning linkage blocks to the backend.
 *
 * Used by MIR, CIR, WIR (with gate overrides) and FAT (without gate overrides).
 *
 * Goes through the shared `@/lib/api` axios instance so the Authorization
 * header + 401-refresh interceptor apply — a previous version of this file
 * used a bare `axios` client and silently lost the Bearer token, causing
 * every save to fail with 401 in production builds.
 */
export async function saveCommissioningLinkage(
  commissioningLinkage: CommissioningLinkage | null,
  docId: string | null,
  deps: CommissioningLinkagePersistDeps,
  options?: { skipGateOverrides?: boolean },
): Promise<void> {
  if (!commissioningLinkage || !docId) return;

  const { setCommissioningLinkage } = deps;
  const skipGateOverrides = options?.skipGateOverrides ?? false;

  // Track created work item IDs so we can clear newItems after persisting.
  // Without this, a second save without refresh would re-create the same
  // work items, producing duplicates.
  const createdIdsByBlockAndAsset = new Map<string, Map<string, string[]>>();

  for (const block of commissioningLinkage) {
    if (!block.requirementTemplateId || block.assetIds.length === 0) continue;

    for (const assetId of block.assetIds) {
      const arRes = await api.get<unknown[]>("/commissioning/asset-requirements", {
        params: { asset_id: assetId },
      });
      const assetReq = (arRes.data as Array<Record<string, unknown>>).find(
        (ar) => ar.requirement_template_id === block.requirementTemplateId,
      );
      if (!assetReq) continue;

      if (block.isPartialScope) {
        const assetState = block.assetStates[assetId];

        for (const delId of assetState?.deleteExistingIds ?? []) {
          try {
            await api.delete(`/commissioning/work-items/${delId}`);
          } catch (err) {
            console.error("Failed to delete work item:", err);
            toast.error("Failed to delete a previously-linked work item");
          }
        }

        const createdLinkedIds: string[] = [];
        for (let i = 0; i < (assetState?.newItems ?? []).length; i++) {
          const newItem = assetState!.newItems[i];
          const wiCreated = await api.post<{ id: string }>(
            "/commissioning/work-items",
            {
              asset_requirement_id: assetReq.id,
              name: newItem.name,
              sequence_no: i + 100,
              created_dynamically: true,
            },
          );
          if (newItem.checked) createdLinkedIds.push(wiCreated.data.id);
        }

        // Track created IDs so we can move them into checkedExistingIds
        if (createdLinkedIds.length > 0) {
          if (!createdIdsByBlockAndAsset.has(block.id)) {
            createdIdsByBlockAndAsset.set(block.id, new Map());
          }
          createdIdsByBlockAndAsset
            .get(block.id)!
            .set(assetId, [...createdLinkedIds]);
        }

        // Delete all existing document-links for this asset_requirement
        // so we can recreate a clean set (prevents duplicates and handles
        // unchecked items).
        try {
          await api.delete("/commissioning/document-links", {
            params: { document_id: docId, asset_requirement_id: assetReq.id },
          });
        } catch {
          /* ignore — endpoint may 404 on a fresh link set */
        }

        for (const wiId of assetState?.checkedExistingIds ?? []) {
          try {
            await api.post("/commissioning/document-links", {
              document_id: docId,
              asset_requirement_id: assetReq.id,
              requirement_work_item_id: wiId,
            });
          } catch (err) {
            console.error(
              "Failed to create document-requirement link:",
              err,
            );
            toast.error("Failed to link a checked work item to the document");
          }
        }
        for (const wiId of createdLinkedIds) {
          try {
            await api.post("/commissioning/document-links", {
              document_id: docId,
              asset_requirement_id: assetReq.id,
              requirement_work_item_id: wiId,
            });
          } catch (err) {
            console.error(
              "Failed to create document-requirement link:",
              err,
            );
            toast.error("Failed to link a newly-created work item");
          }
        }
      } else {
        // Clean up existing links first to prevent duplicates on re-save
        try {
          await api.delete("/commissioning/document-links", {
            params: { document_id: docId, asset_requirement_id: assetReq.id },
          });
        } catch {
          /* ignore */
        }
        try {
          await api.post("/commissioning/document-links", {
            document_id: docId,
            asset_requirement_id: assetReq.id,
          });
        } catch (err) {
          console.error(
            "Failed to create document-requirement link:",
            err,
          );
          toast.error("Failed to link the document to its requirements");
        }
      }
    }

    if (!skipGateOverrides && block.gateWarningAcknowledged) {
      for (const assetId of block.assetIds) {
        try {
          await api.post("/commissioning/gate-overrides", {
            asset_id: assetId,
            document_id: docId,
            level_code: block.gateLevelCode || "L2B",
            incomplete_requirements: block.incompleteRequirements || [],
            notes: block.gateOverrideNotes || null,
          });
        } catch (err) {
          console.error("Failed to record gate override:", err);
          toast.error("Failed to record gate override acknowledgement");
        }
      }
    }
  }

  // After persisting, clear newItems and move created IDs into
  // checkedExistingIds so a subsequent save (without refresh) won't
  // re-create the same work items.
  if (createdIdsByBlockAndAsset.size > 0) {
    setCommissioningLinkage((prev) => {
      if (!prev) return null;
      return prev.map((b) => {
        const assetMap = createdIdsByBlockAndAsset.get(b.id);
        if (!assetMap) return b;
        const newAssetStates = { ...b.assetStates };
        for (const [assetId, createdIds] of assetMap.entries()) {
          const s = newAssetStates[assetId];
          if (!s) continue;
          newAssetStates[assetId] = {
            ...s,
            checkedExistingIds: [...s.checkedExistingIds, ...createdIds],
            newItems: [],
          };
        }
        return { ...b, assetStates: newAssetStates };
      });
    });
  }
}

/**
 * Reconstruct CommissioningLinkageBlock[] from a flat list of document-link
 * records and all asset-requirement records, preserving partial-scope
 * (work-item-level) linkage state.
 */
export function buildLinkageBlocksFromLinks(
  links: {
    asset_requirement_id: string;
    requirement_work_item_id: string | null;
  }[],
  allAssetRequirements: {
    id: string;
    asset_id: string;
    requirement_template_id: string;
    status: string;
  }[],
): CommissioningLinkageBlock[] {
  if (links.length === 0) return [];

  const arIdToTmpl = new Map<string, string>();
  const arIdToAsset = new Map<string, string>();
  for (const ar of allAssetRequirements) {
    arIdToTmpl.set(ar.id, ar.requirement_template_id);
    arIdToAsset.set(ar.id, ar.asset_id);
  }

  const byTmpl = new Map<string, Set<string>>();
  // Track checked work-item IDs per (template, asset)
  const checkedByTmplAsset = new Map<string, Set<string>>();
  for (const link of links) {
    const tmpl = arIdToTmpl.get(link.asset_requirement_id);
    const asset = arIdToAsset.get(link.asset_requirement_id);
    if (!tmpl || !asset) continue;
    if (!byTmpl.has(tmpl)) byTmpl.set(tmpl, new Set());
    byTmpl.get(tmpl)!.add(asset);
    if (link.requirement_work_item_id) {
      const key = `${tmpl}|${asset}`;
      if (!checkedByTmplAsset.has(key))
        checkedByTmplAsset.set(key, new Set());
      checkedByTmplAsset.get(key)!.add(link.requirement_work_item_id);
    }
  }

  const blocks: CommissioningLinkageBlock[] = [];
  for (const [tmplId, assetSet] of byTmpl.entries()) {
    const assetIds = [...assetSet];
    const hasWorkItems = assetIds.some(
      (a) => (checkedByTmplAsset.get(`${tmplId}|${a}`)?.size ?? 0) > 0,
    );
    const assetStates: Record<string, any> = {};
    if (hasWorkItems) {
      for (const assetId of assetIds) {
        const checked = checkedByTmplAsset.get(`${tmplId}|${assetId}`);
        if (checked && checked.size > 0) {
          const ar = allAssetRequirements.find(
            (a) =>
              a.asset_id === assetId &&
              a.requirement_template_id === tmplId,
          );
          assetStates[assetId] = {
            assetRequirementId: ar?.id,
            checkedExistingIds: [...checked],
            deleteExistingIds: [],
            newItems: [],
          };
        }
      }
    }
    blocks.push({
      id: Math.random().toString(36).slice(2),
      requirementTemplateId: tmplId,
      assetIds,
      isPartialScope: hasWorkItems,
      assetStates,
    });
  }

  return blocks;
}
