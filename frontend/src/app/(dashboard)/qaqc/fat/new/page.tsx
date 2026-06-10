"use client";

import { useState, useEffect, useRef, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowLeft } from "lucide-react";
import api from "@/lib/api";
import { useSelectedProject } from "@/hooks/use-project";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Form,
  FormField,
  FormItem,
  FormLabel,
  FormControl,
  FormMessage,
} from "@/components/form";
import {
  CommissioningLinkagePanel,
  type CommissioningLinkage,
} from "@/components/commissioning-linkage";
import { omitDocumentCreateOnlyFields } from "@/lib/document-payload";
import { Spinner } from "@/components/ui/spinner";
import { CenteredSpinner } from "@/components/loaders/centered-spinner";
import {
  fatSchema,
  fatDefaultValues,
  buildFatPayload,
  type FatFormValues,
  type Discipline,
  type FatAssetType,
  type FatAsset,
} from "./_lib/fat-form";

export default function NewFATPage() {
  return (
    <Suspense fallback={<CenteredSpinner label="Loading document…" />}>
      <NewFATPageContent />
    </Suspense>
  );
}

function NewFATPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const editId = searchParams.get("id");
  const project = useSelectedProject();
  const queryClient = useQueryClient();

  const [commissioningLinkage, setCommissioningLinkage] =
    useState<CommissioningLinkage | null>(null);
  const linkageDirtyRef = useRef(false);

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

  const form = useForm<FatFormValues>({
    resolver: zodResolver(fatSchema),
    defaultValues: fatDefaultValues,
  });

  const disciplineId = form.watch("discipline_id");

  // Load existing document
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
  // Only runs when existingDoc first becomes available (guarded by existingDocLoadedRef).
  // form.reset is stable and doesn't need to be a dep.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [existingDoc]);

  useEffect(() => {
    // Reference number is allocated server-side at the moment of save.
    // We no longer pre-fetch it (it could go stale). For new docs the
    // field stays empty until the save response populates it.
    if (editId) return;
    if (!project?.id || !disciplineId || disciplines.length === 0) return;
    form.setValue("reference_no", "");
  }, [editId, project?.id, disciplineId, disciplines, form]);

  // Restore commissioning linkage
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
        if (links.length === 0) return;
        const arIdToTmpl = new Map<string, string>();
        const arIdToAsset = new Map<string, string>();
        for (const ar of allAssetRequirements) {
          arIdToTmpl.set(ar.id, ar.requirement_template_id);
          arIdToAsset.set(ar.id, ar.asset_id);
        }
        const byTmpl = new Map<string, Set<string>>();
        for (const link of links) {
          const tmpl = arIdToTmpl.get(link.asset_requirement_id);
          if (!tmpl) continue;
          if (!byTmpl.has(tmpl)) byTmpl.set(tmpl, new Set());
          byTmpl.get(tmpl)!.add(arIdToAsset.get(link.asset_requirement_id)!);
        }
        const blocks: import("@/components/commissioning-linkage").CommissioningLinkageBlock[] =
          [];
        for (const [tmplId, assetSet] of byTmpl.entries()) {
          blocks.push({
            id: Math.random().toString(36).slice(2),
            requirementTemplateId: tmplId,
            assetIds: [...assetSet],
            isPartialScope: links.some(
              (l) => l.requirement_work_item_id != null,
            ),
            assetStates: {},
          });
        }
        if (blocks.length > 0) setCommissioningLinkage(blocks);
      })
      .catch((err) => {
        if (err && typeof err === "object" && "code" in err && (err as any).code === "ERR_CANCELED") return;
        console.error("Failed to restore commissioning linkage:", err);
      });
    return () => controller.abort();
  }, [editId, allAssetRequirements, commissioningLinkage]);

  // Filter assets by discipline (via AssetType → Service → Discipline chain)
  const _disciplineTypeIds = disciplineId
    ? new Set(
        assetTypes
          .filter((t) => {
            const svc = services.find((s) => s.id === t.service_id);
            return svc?.discipline_id === disciplineId;
          })
          .map((t) => t.id),
      )
    : null;

  const saveCommissioningLinkage = async (docId: string | null) => {
    if (!commissioningLinkage || !docId) return;
    for (const block of commissioningLinkage) {
      if (!block.requirementTemplateId || block.assetIds.length === 0) continue;
      for (const assetId of block.assetIds) {
        const arRes = await api.get("/commissioning/asset-requirements", {
          params: { asset_id: assetId },
        });
        const assetReq = (arRes.data as any[]).find(
          (ar: any) =>
            ar.requirement_template_id === block.requirementTemplateId,
        );
        if (!assetReq) continue;
        if (block.isPartialScope) {
          const s = block.assetStates[assetId];
          for (const delId of s?.deleteExistingIds ?? [])
            await api
              .delete(`/commissioning/work-items/${delId}`)
              .catch((err: any) => { console.error("Failed to save commissioning linkage:", err); });
          const created: string[] = [];
          for (let i = 0; i < (s?.newItems ?? []).length; i++) {
            const wi = await api.post("/commissioning/work-items", {
              asset_requirement_id: assetReq.id,
              name: s!.newItems[i].name,
              sequence_no: i + 100,
              created_dynamically: true,
            });
            if (s!.newItems[i].checked) created.push(wi.data.id);
          }
          for (const wiId of [...(s?.checkedExistingIds ?? []), ...created]) {
            await api
              .post("/commissioning/document-links", {
                document_id: docId,
                asset_requirement_id: assetReq.id,
                requirement_work_item_id: wiId,
              })
              .catch((err: any) => { console.error("Failed to save commissioning linkage:", err); });
          }
        } else {
          await api
            .post("/commissioning/document-links", {
              document_id: docId,
              asset_requirement_id: assetReq.id,
            })
            .catch((err: any) => { console.error("Failed to create document-requirement link:", err); });
        }
      }
    }
  };

  const mutation = useMutation({
    mutationFn: async (values: FatFormValues) => {
      const blockAssetIds = commissioningLinkage
        ? [...new Set(commissioningLinkage.flatMap((b) => b.assetIds))]
        : [];
      const assetName = blockAssetIds[0]
        ? assets.find((a) => a.id === blockAssetIds[0])?.name ?? null
        : null;
      const payload = buildFatPayload(values, project!.id, blockAssetIds, assetName);
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
      if (linkageDirtyRef.current) {
        await saveCommissioningLinkage(docId);
        linkageDirtyRef.current = false;
      }
      return res;
    },
    onSuccess: (res) => {
      toast.success(editId ? "FAT updated" : "FAT saved");
      // Server returns the assigned reference number; surface it immediately
      // so the user sees the value in the (now read-only) reference field.
      if (res?.data?.reference_no)
        form.setValue("reference_no", res.data.reference_no);
      queryClient.invalidateQueries({ queryKey: ["documents", "FAT"] });
      if (!editId && res?.data?.id)
        router.replace(`/qaqc/fat/new?id=${res.data.id}`);
    },
  });

  const handleBack = () => router.push("/qaqc/fat");

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="sm" onClick={handleBack}>
          <ArrowLeft className="h-4 w-4 mr-1" />
          Back
        </Button>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {editId ? "Edit" : "New"} Factory Acceptance Test
          </h1>
          <p className="text-sm text-muted-foreground">Fill in the FAT form</p>
        </div>
      </div>

      <Form {...form}>
        <form
          onSubmit={form.handleSubmit((v) => mutation.mutate(v))}
          noValidate
          className="space-y-6"
        >
          <Card>
            <CardHeader>
              <CardTitle className="text-base">General Information</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="reference_no"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Reference Number</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        disabled
                        className="font-mono bg-muted"
                        placeholder="Reference will be assigned on save"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="discipline_id"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Discipline *</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select discipline">
                            {field.value
                              ? disciplines.find((d) => d.id === field.value)
                                  ?.name
                              : ""}
                          </SelectValue>
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {disciplines.map((d) => (
                          <SelectItem key={d.id} value={d.id}>
                            {d.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <div className="sm:col-span-2">
                <FormField
                  control={form.control}
                  name="description"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Description</FormLabel>
                      <FormControl>
                        <Textarea
                          rows={3}
                          placeholder="Description"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </CardContent>
          </Card>

          {/* Commissioning Linkage */}
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
                        .catch((err: any) => { console.error("Failed to save commissioning linkage:", err); });
                  }
                }}
              />
            </CardContent>
          </Card>

          {/* Actions */}
          <div className="flex justify-end gap-3">
            <Button type="button" variant="outline" onClick={handleBack}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={mutation.isPending}
              aria-busy={mutation.isPending || undefined}
            >
              {mutation.isPending && (
                <Spinner size="sm" className="mr-1 text-current" />
              )}
              {mutation.isPending ? "Saving…" : "Save"}
            </Button>
          </div>
        </form>
      </Form>
    </div>
  );
}
