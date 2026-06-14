"use client";

import type { FatAsset } from "../_lib/fat-form";
import type { CommissioningLinkage } from "@/components/commissioning-linkage";
import { CommissioningLinkagePanel } from "@/components/commissioning-linkage";
import { Card, CardContent } from "@/components/ui/card";
import api from "@/lib/api";

export function FatLinkageCard({
  assets,
  allAssetRequirements,
  editId,
  commissioningLinkage,
  setCommissioningLinkage,
  linkageDirtyRef,
}: {
  assets: FatAsset[];
  allAssetRequirements: {
    id: string;
    asset_id: string;
    requirement_template_id: string;
    status: string;
  }[];
  editId: string | null;
  commissioningLinkage: CommissioningLinkage | null;
  setCommissioningLinkage: (
    linkage: CommissioningLinkage | null,
  ) => void;
  linkageDirtyRef: React.MutableRefObject<boolean>;
}) {
  return (
    <Card>
      <CardContent className="pt-6">
        <CommissioningLinkagePanel
          allAssetIds={assets.map((a) => a.id)}
          allAssetLabels={Object.fromEntries(
            assets.map((a) => [a.id, a.tag_number || a.name]),
          )}
          allAssetNames={Object.fromEntries(
            assets.map((a) => [a.id, a.name]),
          )}
          allAssetRequirements={allAssetRequirements}
          documentType="FAT"
          templates={[]}
          selectedRequirements={[]}
          value={commissioningLinkage}
          onChange={(linkage) => {
            setCommissioningLinkage(linkage);
            linkageDirtyRef.current = true;
          }}
          onUnlinkAssets={async (tmplId, assetIds) => {
            if (!editId) return;
            for (const assetId of assetIds) {
              const arRes = await api.get(
                "/commissioning/asset-requirements",
                { params: { asset_id: assetId } },
              );
              const ar = (arRes.data as any[]).find(
                (r: any) => r.requirement_template_id === tmplId,
              );
              if (ar)
                await api
                  .delete("/commissioning/document-links", {
                    params: {
                      document_id: editId,
                      asset_requirement_id: ar.id,
                    },
                  })
                  .catch((err: any) => {
                    console.error(
                      "Failed to save commissioning linkage:",
                      err,
                    );
                  });
            }
          }}
        />
      </CardContent>
    </Card>
  );
}
