"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import api from "@/lib/api";
import { useSelectedProject } from "@/hooks/use-project";
import { toast } from "sonner";
import type { CommissioningLinkage } from "@/components/commissioning-linkage";
import { omitDocumentCreateOnlyFields } from "@/lib/document-payload";
import {
  saveCommissioningLinkage,
  buildLinkageBlocksFromLinks,
} from "@/lib/commissioning-linkage-persist";
import {
  fatSchema,
  fatDefaultValues,
  buildFatPayload,
  type FatFormValues,
  type Discipline,
  type FatAssetType,
  type FatAsset,
} from "./fat-form";

export function useFatForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const editId = searchParams.get("id");
  const project = useSelectedProject();
  const queryClient = useQueryClient();

  const [commissioningLinkage, setCommissioningLinkage] =
    useState<CommissioningLinkage | null>(null);
  const linkageDirtyRef = useRef(false);

  // ── Reference data queries ──────────────────────────────────────────

  const { data: disciplines = [] } = useQuery<Discipline[]>({
    queryKey: ["disciplines", project?.id],
    queryFn: async () =>
      (await api.get("/disciplines", { params: { project_id: project?.id } }))
        .data,
    enabled: !!project?.id,
  });

  const { data: assetTypes = [] } = useQuery<FatAssetType[]>({
    queryKey: ["asset-types"],
    queryFn: async () => (await api.get("/asset-types")).data,
  });

  const { data: services = [] } = useQuery<
    { id: string; discipline_id: string }[]
  >({
    queryKey: ["services"],
    queryFn: async () => (await api.get("/services")).data,
  });

  const { data: assets = [] } = useQuery<FatAsset[]>({
    queryKey: ["assets", project?.id],
    queryFn: async () =>
      (await api.get("/assets", { params: { project_id: project?.id } })).data,
    enabled: !!project?.id,
  });

  const { data: allAssetRequirements = [] } = useQuery<
    {
      id: string;
      asset_id: string;
      requirement_template_id: string;
      status: string;
    }[]
  >({
    queryKey: ["asset-requirements-all", project?.id],
    queryFn: async () =>
      (
        await api.get("/commissioning/asset-requirements", {
          params: { project_id: project?.id },
        })
      ).data,
    enabled: !!project?.id,
  });

  // ── Form ──────────────────────────────────────────────────────────────

  const form = useForm<FatFormValues>({
    resolver: zodResolver(fatSchema),
    defaultValues: fatDefaultValues,
  });

  const disciplineId = form.watch("discipline_id");

  // ── Existing document ──────────────────────────────────────────────────

  const { data: existingDoc } = useQuery({
    queryKey: ["document", editId],
    queryFn: async () => (await api.get(`/documents/${editId}`)).data,
    enabled: !!editId,
  });

  const existingDocLoadedRef = useRef(false);

  useEffect(() => {
    if (existingDoc && !existingDocLoadedRef.current) {
      existingDocLoadedRef.current = true;
      form.reset({
        reference_no: existingDoc.reference_no || "",
        description: existingDoc.description || "",
        discipline_id: existingDoc.discipline_id || "",
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [existingDoc]);

  // Clear reference number when project/discipline changes on new doc
  useEffect(() => {
    if (editId) return;
    if (!project?.id || !disciplineId || disciplines.length === 0) return;
    form.setValue("reference_no", "");
  }, [editId, project?.id, disciplineId, disciplines, form]);

  // ── Commissioning linkage restore ──────────────────────────────────────

  useEffect(() => {
    if (!editId || allAssetRequirements.length === 0 || commissioningLinkage)
      return;
    const controller = new AbortController();
    api
      .get("/commissioning/document-links", {
        params: { document_id: editId },
        signal: controller.signal,
      })
      .then(async (res) => {
        const links = res.data as {
          asset_requirement_id: string;
          requirement_work_item_id: string | null;
        }[];
        const blocks = buildLinkageBlocksFromLinks(links, allAssetRequirements);
        if (blocks.length > 0) setCommissioningLinkage(blocks);
      })
      .catch((err) => {
        if (
          err &&
          typeof err === "object" &&
          "code" in err &&
          (err as any).code === "ERR_CANCELED"
        )
          return;
        console.error("Failed to restore commissioning linkage:", err);
      });
    return () => controller.abort();
  }, [editId, allAssetRequirements, commissioningLinkage]);

  // ── Derived: asset type IDs for selected discipline ────────────────────

  const disciplineTypeIds = disciplineId
    ? new Set(
        assetTypes
          .filter((t) => {
            const svc = services.find((s) => s.id === t.service_id);
            return svc?.discipline_id === disciplineId;
          })
          .map((t) => t.id),
      )
    : null;

  // ── Persist commissioning linkage ──────────────────────────────────────

  const persistLinkage = async (docId: string | null) => {
    await saveCommissioningLinkage(
      commissioningLinkage,
      docId,
      { api, setCommissioningLinkage },
      { skipGateOverrides: true },
    );
  };

  // ── Save mutation ──────────────────────────────────────────────────────

  const mutation = useMutation({
    mutationFn: async (values: FatFormValues) => {
      const blockAssetIds = commissioningLinkage
        ? [...new Set(commissioningLinkage.flatMap((b) => b.assetIds))]
        : [];
      const assetName = blockAssetIds[0]
        ? assets.find((a) => a.id === blockAssetIds[0])?.name ?? null
        : null;
      const payload = buildFatPayload(
        values,
        project!.id,
        blockAssetIds,
        assetName,
      );
      let res;
      if (editId) {
        res = await api.patch(
          `/documents/${editId}`,
          omitDocumentCreateOnlyFields(payload),
        );
      } else {
        res = await api.post("/documents", payload);
      }
      const docId = res.data?.id || editId;
      if (linkageDirtyRef.current || editId) {
        await persistLinkage(docId);
        linkageDirtyRef.current = false;
      }
      return res;
    },
    onSuccess: (res) => {
      toast.success(editId ? "FAT updated" : "FAT saved");
      if (res?.data?.reference_no)
        form.setValue("reference_no", res.data.reference_no);
      queryClient.invalidateQueries({ queryKey: ["documents", "FAT"] });
      if (!editId && res?.data?.id)
        router.replace(`/qaqc/fat/new?id=${res.data.id}`);
    },
  });

  const handleBack = () => router.push("/qaqc/fat");

  return {
    form,
    mutation,
    handleBack,
    editId,
    disciplines,
    assetTypes,
    services,
    assets,
    allAssetRequirements,
    disciplineTypeIds,
    commissioningLinkage,
    setCommissioningLinkage,
    linkageDirtyRef,
    existingDoc,
  };
}
