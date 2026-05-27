"use client";

import { useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { z } from "zod/v4";
import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowLeft, PenLine, X } from "lucide-react";
import api from "@/lib/api";
import { useSelectedProject } from "@/hooks/use-project";
import { useCurrentUser } from "@/hooks/use-auth";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DatePicker } from "@/components/ui/date-picker";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Form, FormField, FormItem, FormLabel, FormControl, FormMessage } from "@/components/form";
import { CommissioningLinkagePanel, type CommissioningLinkage } from "@/components/commissioning-linkage";
import { ApprovalChain } from "@/components/approval-chain";

interface Discipline { id: string; name: string; code: string; }
interface User { id: string; full_name: string; position: string | null; signature_text: string | null; signature_font: string | null; }
interface AssetType { id: string; name: string; code: string; parent_type_id?: string | null; }
interface Asset { id: string; name: string; tag_number: string; asset_type_id: string; }

const schema = z.object({
  title: z.string().min(1, "Title is required"),
  description: z.string().min(1, "Description is required"),
  discipline_id: z.string().min(1, "Discipline is required"),
  asset_type_id: z.string().min(1, "Asset type is required"),
  date: z.string().optional(),
  inspector_1_id: z.string().optional(),
  inspector_2_id: z.string().optional(),
});

type FormValues = z.infer<typeof schema>;

export default function NewFATPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const editId = searchParams.get("id");
  const project = useSelectedProject();
  const { data: currentUser } = useCurrentUser();
  const queryClient = useQueryClient();
  const [selectedAssetIds, setSelectedAssetIds] = useState<string[]>([]);
  const [signed, setSigned] = useState<{ inspector1: boolean; inspector2: boolean }>({ inspector1: false, inspector2: false });
  const [commissioningLinkage, setCommissioningLinkage] = useState<CommissioningLinkage | null>(null);
  const [referenceNo, setReferenceNo] = useState<string>("");

  const { data: disciplines = [] } = useQuery<Discipline[]>({
    queryKey: ["disciplines"],
    queryFn: async () => (await api.get("/disciplines")).data,
  });

  const { data: users = [] } = useQuery<User[]>({
    queryKey: ["users"],
    queryFn: async () => (await api.get("/admin/users")).data,
  });

  const { data: assetTypes = [] } = useQuery<AssetType[]>({
    queryKey: ["asset-types"],
    queryFn: async () => (await api.get("/asset-types")).data,
  });

  const { data: allAssets = [] } = useQuery<Asset[]>({
    queryKey: ["assets"],
    queryFn: async () => (await api.get("/assets")).data,
  });

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      title: "",
      description: "",
      discipline_id: "",
      asset_type_id: "",
      date: new Date().toISOString().split("T")[0],
      inspector_1_id: "",
      inspector_2_id: "",
    },
  });

  const assetTypeId = form.watch("asset_type_id");
  const disciplineId = form.watch("discipline_id");
  const inspector1Id = form.watch("inspector_1_id");
  const inspector2Id = form.watch("inspector_2_id");

  // Filter assets by selected asset type (include subtypes via parent_type_id)
  const filteredAssets = assetTypeId
    ? allAssets.filter((a) => {
        if (a.asset_type_id === assetTypeId) return true;
        const type = assetTypes.find((t) => t.id === a.asset_type_id);
        return type?.parent_type_id === assetTypeId;
      })
    : [];

  // Auto-select all when asset type changes
  useEffect(() => {
    setSelectedAssetIds(filteredAssets.map((a) => a.id));
  }, [assetTypeId, allAssets.length]); // eslint-disable-line react-hooks/exhaustive-deps

  // Load existing document
  const { data: existingDoc } = useQuery({
    queryKey: ["document", editId],
    queryFn: async () => (await api.get(`/documents/${editId}`)).data,
    enabled: !!editId,
  });

  useEffect(() => {
    if (existingDoc) {
      form.reset({
        title: existingDoc.title || "",
        description: existingDoc.description || "",
        discipline_id: existingDoc.discipline_id || "",
        asset_type_id: existingDoc.asset_type_id || "",
        date: existingDoc.inspection_date ? existingDoc.inspection_date.split("T")[0] : "",
        inspector_1_id: existingDoc.inspector_1_id || "",
        inspector_2_id: existingDoc.inspector_2_id || "",
      });
      setSigned({
        inspector1: !!existingDoc.inspector_1_signed,
        inspector2: !!existingDoc.inspector_2_signed,
      });
      setReferenceNo(existingDoc.reference_no || "");
      if (existingDoc.asset_ids) setSelectedAssetIds(existingDoc.asset_ids);
    }
  }, [existingDoc]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-generate reference number
  useEffect(() => {
    if (!editId && disciplineId && project?.id && disciplines.length > 0) {
      const disciplineCode = disciplines.find((d) => d.id === disciplineId)?.code || "";
      api.get("/documents/generate-ref-number", {
        params: { project_id: project.id, doc_type: "FAT", discipline_code: disciplineCode },
      }).then((res) => setReferenceNo(res.data.reference_number)).catch(() => {});
    }
  }, [editId, disciplineId, project?.id, disciplines.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleAsset = (id: string) => {
    setSelectedAssetIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const buildPayload = (values: FormValues) => ({
    project_id: project!.id,
    document_type: "FAT",
    reference_no: referenceNo || "",
    title: values.title,
    description: values.description,
    discipline_id: values.discipline_id,
    asset_type_id: values.asset_type_id,
    inspection_date: values.date || null,
    inspector_1_id: values.inspector_1_id || null,
    inspector_2_id: values.inspector_2_id || null,
    inspector_1_signed: signed.inspector1,
    inspector_2_signed: signed.inspector2,
    asset_ids: selectedAssetIds,
  });

  const mutation = useMutation({
    mutationFn: async (values: FormValues) => {
      if (editId) {
        const { project_id, document_type, reference_no, ...updatePayload } = buildPayload(values);
        return api.patch(`/documents/${editId}`, updatePayload);
      }
      return api.post("/documents", buildPayload(values));
    },
    onSuccess: () => {
      toast.success(editId ? "FAT updated" : "FAT saved as draft");
      queryClient.invalidateQueries({ queryKey: ["documents", "FAT"] });
      router.push("/qaqc/fat");
    },
  });

  const handleBack = () => {
    if (form.formState.isDirty) {
      if (confirm("You have unsaved changes. Save as draft before leaving?")) {
        form.handleSubmit((v) => mutation.mutate(v))();
        return;
      }
    }
    router.push("/qaqc/fat");
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="sm" onClick={handleBack}>
          <ArrowLeft className="h-4 w-4 mr-1" />Back
        </Button>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{editId ? "Edit Factory Acceptance Test" : "New Factory Acceptance Test"}</h1>
          <p className="text-sm text-muted-foreground">Fill in the FAT submission form</p>
        </div>
      </div>

      <Form {...form}>
        <form onSubmit={form.handleSubmit((v) => mutation.mutate(v))} noValidate className="space-y-6">
          <Card>
            <CardHeader><CardTitle className="text-base">General Information</CardTitle></CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <FormItem>
                  <FormLabel>Reference Number</FormLabel>
                  <Input value={referenceNo} disabled className="font-mono bg-muted" placeholder="Select discipline to generate..." />
                </FormItem>
              </div>
              <FormField control={form.control} name="date" render={({ field }) => (
                <FormItem><FormLabel>Date</FormLabel><FormControl><DatePicker value={field.value} onChange={field.onChange} /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="discipline_id" render={({ field }) => (
                <FormItem>
                  <FormLabel>Discipline *</FormLabel>
                  <Select onValueChange={(v: any) => field.onChange(v)} value={field.value}>
                    <FormControl><SelectTrigger><SelectValue placeholder="Select discipline">{field.value ? disciplines.find((d) => d.id === field.value)?.name : ""}</SelectValue></SelectTrigger></FormControl>
                    <SelectContent>{disciplines.map((d) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}</SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />
              <div className="sm:col-span-2">
                <FormField control={form.control} name="title" render={({ field }) => (
                  <FormItem><FormLabel>Title *</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
                )} />
              </div>
              <div className="sm:col-span-2">
                <FormField control={form.control} name="description" render={({ field }) => (
                  <FormItem><FormLabel>Description *</FormLabel><FormControl><Textarea rows={3} {...field} /></FormControl><FormMessage /></FormItem>
                )} />
              </div>
              <FormField control={form.control} name="asset_type_id" render={({ field }) => (
                <FormItem>
                  <FormLabel>Asset Type *</FormLabel>
                  <Select onValueChange={(v: any) => field.onChange(v)} value={field.value}>
                    <FormControl><SelectTrigger><SelectValue placeholder="Select asset type">{field.value ? assetTypes.find((t) => t.id === field.value)?.name : ""}</SelectValue></SelectTrigger></FormControl>
                    <SelectContent>{assetTypes.map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}</SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />
            </CardContent>
          </Card>

          {/* Assets loaded by type */}
          {assetTypeId && (
            <Card>
              <CardHeader><CardTitle className="text-base">Assets ({selectedAssetIds.length}/{filteredAssets.length} selected)</CardTitle></CardHeader>
              <CardContent>
                {filteredAssets.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No assets found for this type.</p>
                ) : (
                  <div className="space-y-2 max-h-64 overflow-y-auto">
                    {filteredAssets.map((asset) => (
                      <label key={asset.id} className="flex items-center gap-3 rounded-md border px-3 py-2 cursor-pointer hover:bg-accent/50">
                        <input
                          type="checkbox"
                          checked={selectedAssetIds.includes(asset.id)}
                          onChange={() => toggleAsset(asset.id)}
                          className="h-4 w-4 rounded border-input"
                        />
                        <span className="text-sm">{asset.tag_number} — {asset.name}</span>
                      </label>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Commissioning Linkage */}
          <Card>
            <CardContent className="pt-6">
              <CommissioningLinkagePanel
                projectId={project?.id || ""}
                selectedAssetIds={selectedAssetIds}
                documentType="FAT"
                value={commissioningLinkage}
                onChange={setCommissioningLinkage}
              />
            </CardContent>
          </Card>

          {/* Inspectors & Signatures */}
          <Card>
            <CardHeader><CardTitle className="text-base">Inspected By</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-3">
                  <FormField control={form.control} name="inspector_1_id" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Inspector 1</FormLabel>
                      <Select onValueChange={(v: any) => field.onChange(v)} value={field.value}>
                        <FormControl><SelectTrigger><SelectValue placeholder="Name and Designation">{inspector1Id ? users.find((u) => u.id === inspector1Id)?.full_name || "" : ""}</SelectValue></SelectTrigger></FormControl>
                        <SelectContent>
                          {users.map((u) => (
                            <SelectItem key={u.id} value={u.id}>
                              <span className="inline-flex items-baseline gap-2"><span>{u.full_name}:</span><span className="text-muted-foreground">{u.position || "—"}</span></span>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </FormItem>
                  )} />
                  <div
                    className={`h-16 rounded-md border-2 border-dashed flex items-center justify-center transition-colors ${
                      signed.inspector1
                        ? "border-emerald-500/50 bg-emerald-500/5"
                        : currentUser?.id === inspector1Id
                          ? "border-border hover:border-primary/50 cursor-pointer"
                          : "border-border opacity-50 cursor-not-allowed"
                    }`}
                    onClick={() => { if (currentUser?.id === inspector1Id) setSigned((s) => ({ ...s, inspector1: !s.inspector1 })); }}
                  >
                    {signed.inspector1 ? (
                      <img
                        src={`${api.defaults.baseURL}/reports/signature-preview?name=${encodeURIComponent((() => { const u = users.find((u) => u.id === inspector1Id); return u?.signature_text || u?.full_name || ""; })())}&font_id=${users.find((u) => u.id === inspector1Id)?.signature_font || "dancing_script"}&color=%2316a34a`}
                        alt="Signature"
                        className="h-10 object-contain"
                      />
                    ) : (
                      <span className="text-sm text-muted-foreground">{currentUser?.id === inspector1Id ? "Click to sign" : "Awaiting signature"}</span>
                    )}
                  </div>
                  {currentUser?.id === inspector1Id && (
                    <Link href="/profile" className="text-xs text-primary hover:underline inline-flex items-center gap-1"><PenLine className="h-3 w-3" />Change signature style</Link>
                  )}
                </div>
                <div className="space-y-3">
                  <FormField control={form.control} name="inspector_2_id" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Inspector 2</FormLabel>
                      <Select onValueChange={(v: any) => field.onChange(v)} value={field.value}>
                        <FormControl><SelectTrigger><SelectValue placeholder="Name and Designation">{inspector2Id ? users.find((u) => u.id === inspector2Id)?.full_name || "" : ""}</SelectValue></SelectTrigger></FormControl>
                        <SelectContent>
                          {users.map((u) => (
                            <SelectItem key={u.id} value={u.id}>
                              <span className="inline-flex items-baseline gap-2"><span>{u.full_name}:</span><span className="text-muted-foreground">{u.position || "—"}</span></span>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </FormItem>
                  )} />
                  <div
                    className={`h-16 rounded-md border-2 border-dashed flex items-center justify-center transition-colors ${
                      signed.inspector2
                        ? "border-emerald-500/50 bg-emerald-500/5"
                        : currentUser?.id === inspector2Id
                          ? "border-border hover:border-primary/50 cursor-pointer"
                          : "border-border opacity-50 cursor-not-allowed"
                    }`}
                    onClick={() => { if (currentUser?.id === inspector2Id) setSigned((s) => ({ ...s, inspector2: !s.inspector2 })); }}
                  >
                    {signed.inspector2 ? (
                      <img
                        src={`${api.defaults.baseURL}/reports/signature-preview?name=${encodeURIComponent((() => { const u = users.find((u) => u.id === inspector2Id); return u?.signature_text || u?.full_name || ""; })())}&font_id=${users.find((u) => u.id === inspector2Id)?.signature_font || "dancing_script"}&color=%2316a34a`}
                        alt="Signature"
                        className="h-10 object-contain"
                      />
                    ) : (
                      <span className="text-sm text-muted-foreground">{currentUser?.id === inspector2Id ? "Click to sign" : "Awaiting signature"}</span>
                    )}
                  </div>
                  {currentUser?.id === inspector2Id && (
                    <Link href="/profile" className="text-xs text-primary hover:underline inline-flex items-center gap-1"><PenLine className="h-3 w-3" />Change signature style</Link>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Actions */}
          <div className="flex justify-end gap-3">
            <Button type="button" variant="outline" onClick={handleBack}>Cancel</Button>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? "Saving..." : "Save as Draft"}
            </Button>
          </div>
        </form>
      </Form>

      {/* Approval Chain */}
      {editId && existingDoc && existingDoc.status !== "draft" && (
        <Card>
          <CardContent className="pt-6">
            <ApprovalChain documentId={editId} documentStatus={existingDoc.status} />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
