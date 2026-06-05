"use client";

import { useState, useEffect, useRef, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { z } from "zod/v4";
import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowLeft, ChevronDown, X } from "lucide-react";
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
import { Badge } from "@/components/ui/badge";
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

interface Discipline {
  id: string;
  name: string;
  code: string;
}
interface AssetType {
  id: string;
  name: string;
  code: string;
  service_id: string;
  parent_type_id: string | null;
}
interface Asset {
  id: string;
  name: string;
  tag_number: string;
  asset_type_id: string;
}

const schema = z.object({
  reference_no: z.string().optional(),
  description: z.string().optional(),
  discipline_id: z.string().min(1, "Discipline is required"),
});

type FormValues = z.infer<typeof schema>;

export default function NewFATPage() {
  return (
    <Suspense
      fallback={
        <div className="p-8 text-center text-muted-foreground">Loading...</div>
      }
    >
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

  const [selectedAssets, setSelectedAssets] = useState<Asset[]>([]);
  const [assetSearch, setAssetSearch] = useState("");
  const [filterAssetTypeId, setFilterAssetTypeId] = useState("");
  const [assetsOpen, setAssetsOpen] = useState(false);
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

  const { data: assetTypes = [] } = useQuery<AssetType[]>({
    queryKey: ["asset-types"],
    queryFn: async () => (await api.get("/asset-types")).data,
  });

  const { data: services = [] } = useQuery<
    { id: string; discipline_id: string }[]
  >({
    queryKey: ["services"],
    queryFn: async () => (await api.get("/services")).data,
  });

  const { data: assets = [] } = useQuery<Asset[]>({
    queryKey: ["assets", project?.id],
    queryFn: async () =>
      (await api.get("/assets", { params: { project_id: project?.id } })).data,
    enabled: !!project?.id,
  });

  const { data: allAssetRequirements = [] } = useQuery<
    { id: string; asset_id: string; requirement_template_id: string }[]
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

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { reference_no: "", description: "", discipline_id: "" },
  });

  const disciplineId = form.watch("discipline_id");

  // Load existing document
  const { data: existingDoc } = useQuery({
    queryKey: ["document", editId],
    queryFn: async () => (await api.get(`/documents/${editId}`)).data,
    enabled: !!editId,
  });

  useEffect(() => {
    if (existingDoc) {
      form.reset({
        reference_no: existingDoc.reference_no || "",
        description: existingDoc.description || "",
        discipline_id: existingDoc.discipline_id || "",
      });
      if (existingDoc.asset_ids?.length && assets.length > 0) {
        const ids = new Set(existingDoc.asset_ids);
        setSelectedAssets(assets.filter((a) => ids.has(a.id)));
      }
    }
  }, [existingDoc, assets.length]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (editId) return;
    if (!project?.id || !disciplineId || disciplines.length === 0) return;

    const disciplineCode =
      disciplines.find((d) => d.id === disciplineId)?.code || "";

    if (!disciplineCode) return;

    api
      .get("/documents/generate-ref-number", {
        params: {
          project_id: project.id,
          doc_type: "FAT",
          discipline_code: disciplineCode,
        },
      })
      .then((res) => {
        form.setValue("reference_no", res.data.reference_number || "");
      })
      .catch(() => {
        toast.error("Failed to generate reference number");
      });
  }, [editId, project?.id, disciplineId, disciplines, form]);

  // Restore commissioning linkage
  useEffect(() => {
    if (!editId || allAssetRequirements.length === 0 || commissioningLinkage)
      return;
    api
      .get("/commissioning/document-links", { params: { document_id: editId } })
      .then(async (res) => {
        const links = res.data as {
          asset_requirement_id: string;
          requirement_work_item_id: string | null;
        }[];
        if (links.length === 0) return;
        const firstArId = links[0].asset_requirement_id;
        const ar = allAssetRequirements.find((r) => r.id === firstArId);
        if (!ar) return;
        const hasLinkedWorkItems = links.some(
          (l) => l.requirement_work_item_id != null,
        );
        let isPartial = hasLinkedWorkItems;
        if (!isPartial) {
          const wiRes = await api.get("/commissioning/work-items", {
            params: { asset_requirement_id: firstArId },
          });
          isPartial = wiRes.data.length > 0;
        }
        setCommissioningLinkage({
          requirementTemplateId: ar.requirement_template_id,
          isPartialScope: isPartial,
          checkedExistingIds: links
            .filter((l) => l.requirement_work_item_id)
            .map((l) => l.requirement_work_item_id!),
          deleteExistingIds: [],
          newItems: [],
        });
      })
      .catch(() => {});
  }, [editId, allAssetRequirements.length]); // eslint-disable-line react-hooks/exhaustive-deps

  // Filter assets by discipline (via AssetType → Service → Discipline chain)
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

  const filteredAssets = assets.filter((a) => {
    if (disciplineTypeIds && !disciplineTypeIds.has(a.asset_type_id))
      return false;
    if (filterAssetTypeId && a.asset_type_id !== filterAssetTypeId)
      return false;
    if (assetSearch) {
      const q = assetSearch.toLowerCase();
      if (
        !a.name.toLowerCase().includes(q) &&
        !a.tag_number.toLowerCase().includes(q)
      )
        return false;
    }
    return true;
  });

  const addAsset = (id: string) => {
    const a = assets.find((x) => x.id === id);
    if (a && !selectedAssets.find((x) => x.id === id)) {
      setSelectedAssets([...selectedAssets, a]);
    }
  };
  const removeAsset = (id: string) => {
    setSelectedAssets(selectedAssets.filter((a) => a.id !== id));
  };

  const saveCommissioningLinkage = async (docId: string | null) => {
    if (!commissioningLinkage || !docId || selectedAssets.length === 0) return;
    for (const asset of selectedAssets) {
      const arRes = await api.get("/commissioning/asset-requirements", {
        params: { asset_id: asset.id },
      });
      const assetReq = (arRes.data as any[]).find(
        (ar: any) =>
          ar.requirement_template_id ===
          commissioningLinkage.requirementTemplateId,
      );
      if (!assetReq) continue;
      if (commissioningLinkage.isPartialScope) {
        for (const delId of commissioningLinkage.deleteExistingIds) {
          await api.delete(`/commissioning/work-items/${delId}`);
        }
        const createdIds: string[] = [];
        for (let i = 0; i < commissioningLinkage.newItems.length; i++) {
          const wiRes = await api.post("/commissioning/work-items", {
            asset_requirement_id: assetReq.id,
            name: commissioningLinkage.newItems[i].name,
            sequence_no: i + 100,
            created_dynamically: true,
          });
          if (commissioningLinkage.newItems[i].checked)
            createdIds.push(wiRes.data.id);
        }
        for (const wiId of commissioningLinkage.checkedExistingIds) {
          await api.post("/commissioning/document-links", {
            document_id: docId,
            asset_requirement_id: assetReq.id,
            requirement_work_item_id: wiId,
          });
        }
        for (const wiId of createdIds) {
          await api.post("/commissioning/document-links", {
            document_id: docId,
            asset_requirement_id: assetReq.id,
            requirement_work_item_id: wiId,
          });
        }
      } else {
        await api.post("/commissioning/document-links", {
          document_id: docId,
          asset_requirement_id: assetReq.id,
        });
      }
    }
  };

  const mutation = useMutation({
    mutationFn: async (values: FormValues) => {
      const payload = {
        project_id: project!.id,
        document_type: "FAT",
        reference_no: values.reference_no || "",
        title: values.reference_no || "FAT",
        description: values.description || null,
        discipline_id: values.discipline_id,
        asset_ids: selectedAssets.map((a) => a.id),
      };
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
                      <Input {...field} placeholder="Reference number" />
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
                projectId={project?.id || ""}
                selectedAssetIds={selectedAssets.map((a) => a.id)}
                documentType="FAT"
                value={commissioningLinkage}
                onChange={(linkage) => {
                  setCommissioningLinkage(linkage);
                  linkageDirtyRef.current = true;
                }}
              />
            </CardContent>
          </Card>

          {/* Assets */}
          <Card>
            <CardHeader
              className="cursor-pointer"
              onClick={() => setAssetsOpen(!assetsOpen)}
            >
              <CardTitle className="text-base flex items-center justify-between">
                Assets ({selectedAssets.length} selected)
                <ChevronDown
                  className={
                    "h-4 w-4 text-muted-foreground transition-transform " +
                    (assetsOpen ? "rotate-180" : "")
                  }
                />
              </CardTitle>
            </CardHeader>
            {assetsOpen && (
              <CardContent className="space-y-3">
                {selectedAssets.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {selectedAssets.map((a) => (
                      <Badge
                        key={a.id}
                        variant="secondary"
                        className="gap-1 pr-1"
                      >
                        {a.tag_number}
                        <button
                          type="button"
                          onClick={() => removeAsset(a.id)}
                          className="ml-1 hover:text-destructive"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </Badge>
                    ))}
                  </div>
                )}
                <div className="flex gap-2">
                  <Input
                    placeholder="Search assets..."
                    value={assetSearch}
                    onChange={(e) => setAssetSearch(e.target.value)}
                    className="flex-1"
                  />
                  <Select
                    value={filterAssetTypeId}
                    onValueChange={(v: any) =>
                      setFilterAssetTypeId(v === "__all__" ? "" : v)
                    }
                  >
                    <SelectTrigger className="w-48">
                      <SelectValue>
                        {filterAssetTypeId
                          ? assetTypes.find((t) => t.id === filterAssetTypeId)
                              ?.name
                          : "All Types"}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__all__">All Types</SelectItem>
                      {assetTypes
                        .filter((t) => {
                          if (!disciplineId) return true;
                          const svc = services.find(
                            (s) => s.id === t.service_id,
                          );
                          return svc?.discipline_id === disciplineId;
                        })
                        .map((t) => (
                          <SelectItem key={t.id} value={t.id}>
                            {t.name}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="max-h-48 overflow-y-auto space-y-1 border rounded-md p-2">
                  {filteredAssets
                    .filter((a) => !selectedAssets.find((s) => s.id === a.id))
                    .map((a) => (
                      <label
                        key={a.id}
                        className="flex items-center gap-3 rounded px-2 py-1.5 cursor-pointer hover:bg-accent/50"
                      >
                        <input
                          type="checkbox"
                          onChange={() => addAsset(a.id)}
                          className="h-4 w-4"
                        />
                        <span className="text-sm">
                          {a.tag_number} - {a.name}
                        </span>
                      </label>
                    ))}
                </div>
              </CardContent>
            )}
          </Card>

          {/* Actions */}
          <div className="flex justify-end gap-3">
            <Button type="button" variant="outline" onClick={handleBack}>
              Cancel
            </Button>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? "Saving..." : "Save"}
            </Button>
          </div>
        </form>
      </Form>
    </div>
  );
}
