"use client";

import { useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { z } from "zod/v4";
import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowLeft, Send, PenLine } from "lucide-react";
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
import { X } from "lucide-react";

interface Discipline { id: string; name: string; code: string; }
interface User { id: string; full_name: string; position: string | null; signature_text: string | null; signature_font: string | null; }
interface Asset { id: string; name: string; tag_number: string; }

const schema = z.object({
  subject: z.string().min(1, "Subject is required"),
  discipline_id: z.string().min(1, "Discipline is required"),
  description: z.string().min(1, "Description is required"),
  location: z.string().optional(),
  inspector_1_id: z.string().optional(),
  inspector_2_id: z.string().optional(),
  date: z.string().optional(),
});

type FormValues = z.infer<typeof schema>;

export default function NewCIRPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const editId = searchParams.get("id");
  const project = useSelectedProject();
  const { data: currentUser } = useCurrentUser();
  const queryClient = useQueryClient();
  const [selectedAssets, setSelectedAssets] = useState<Asset[]>([]);
  const [signed, setSigned] = useState<{ inspector1: boolean; inspector2: boolean }>({ inspector1: false, inspector2: false });
  const [commissioningLinkage, setCommissioningLinkage] = useState<CommissioningLinkage | null>(null);
  const [referenceNo, setReferenceNo] = useState("");

  const { data: disciplines = [] } = useQuery<Discipline[]>({ queryKey: ["disciplines"], queryFn: async () => (await api.get("/disciplines")).data });
  const { data: users = [] } = useQuery<User[]>({ queryKey: ["users"], queryFn: async () => (await api.get("/admin/users")).data });
  const { data: assets = [] } = useQuery<Asset[]>({ queryKey: ["assets"], queryFn: async () => (await api.get("/assets")).data });

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { subject: "", discipline_id: "", description: "", location: "", inspector_1_id: "", inspector_2_id: "", date: new Date().toISOString().split("T")[0] },
  });

  const { data: existingDoc } = useQuery({
    queryKey: ["document", editId],
    queryFn: async () => (await api.get(`/documents/${editId}`)).data,
    enabled: !!editId,
  });

  useEffect(() => {
    if (existingDoc) {
      form.reset({
        subject: existingDoc.title || "",
        discipline_id: existingDoc.discipline_id || "",
        description: existingDoc.description || "",
        location: existingDoc.location || "",
        inspector_1_id: existingDoc.site_engineer_id || "",
        inspector_2_id: existingDoc.qaqc_engineer_id || "",
        date: existingDoc.inspection_date ? existingDoc.inspection_date.split("T")[0] : "",
      });
      setSigned({ inspector1: !!existingDoc.site_engineer_signed, inspector2: !!existingDoc.qaqc_engineer_signed });
      setReferenceNo(existingDoc.reference_no || "");
    }
  }, [existingDoc]); // eslint-disable-line react-hooks/exhaustive-deps

  const disciplineId = form.watch("discipline_id");
  useEffect(() => {
    if (!editId && disciplineId && project?.id && disciplines.length > 0) {
      const code = disciplines.find((d) => d.id === disciplineId)?.code || "";
      api.get("/documents/generate-ref-number", { params: { project_id: project.id, doc_type: "CIR", discipline_code: code } })
        .then((res) => setReferenceNo(res.data.reference_number)).catch(() => {});
    }
  }, [editId, disciplineId, project?.id, disciplines.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const inspector1Id = form.watch("inspector_1_id");
  const inspector2Id = form.watch("inspector_2_id");

  const buildPayload = (values: FormValues) => ({
    project_id: project!.id,
    document_type: "CIR",
    reference_no: referenceNo,
    title: values.subject,
    description: values.description,
    discipline_id: values.discipline_id,
    location: values.location || null,
    inspection_date: values.date || null,
    site_engineer_id: values.inspector_1_id || null,
    qaqc_engineer_id: values.inspector_2_id || null,
    site_engineer_signed: signed.inspector1,
    qaqc_engineer_signed: signed.inspector2,
    asset_ids: selectedAssets.map((a) => a.id),
  });

  const mutation = useMutation({
    mutationFn: async (values: FormValues) => {
      let res;
      if (editId) {
        const { project_id, document_type, reference_no, ...payload } = buildPayload(values);
        res = await api.patch(`/documents/${editId}`, payload);
      } else {
        res = await api.post("/documents", buildPayload(values));
      }
      const docId = res.data?.id || editId;
      // Commissioning linkage
      if (commissioningLinkage && docId && selectedAssets.length > 0) {
        for (const asset of selectedAssets) {
          const arRes = await api.get("/commissioning/asset-requirements", { params: { asset_id: asset.id } });
          const assetReq = (arRes.data as any[]).find((ar: any) => ar.requirement_template_id === commissioningLinkage.requirementTemplateId);
          if (!assetReq) continue;
          if (commissioningLinkage.isPartialScope) {
            for (const delId of commissioningLinkage.deleteExistingIds) {
              await api.delete(`/commissioning/work-items/${delId}`);
            }
            const createdIds: string[] = [];
            for (let i = 0; i < commissioningLinkage.newItems.length; i++) {
              const wiRes = await api.post("/commissioning/work-items", { asset_requirement_id: assetReq.id, name: commissioningLinkage.newItems[i].name, sequence_no: i + 100, created_dynamically: true });
              if (commissioningLinkage.newItems[i].checked) createdIds.push(wiRes.data.id);
            }
            for (const wiId of commissioningLinkage.checkedExistingIds) {
              await api.post("/commissioning/document-links", { document_id: docId, asset_requirement_id: assetReq.id, requirement_work_item_id: wiId });
            }
            for (const wiId of createdIds) {
              await api.post("/commissioning/document-links", { document_id: docId, asset_requirement_id: assetReq.id, requirement_work_item_id: wiId });
            }
          } else {
            await api.post("/commissioning/document-links", { document_id: docId, asset_requirement_id: assetReq.id });
          }
        }
      }
      return res;
    },
    onSuccess: () => { toast.success(editId ? "CIR updated" : "CIR saved as draft"); queryClient.invalidateQueries({ queryKey: ["documents", "CIR"] }); router.push("/qaqc/cir"); },
  });

  const addAsset = (id: string) => { const a = assets.find((x) => x.id === id); if (a && !selectedAssets.find((x) => x.id === id)) setSelectedAssets([...selectedAssets, a]); };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="sm" onClick={() => router.push("/qaqc/cir")}><ArrowLeft className="h-4 w-4 mr-1" />Back</Button>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{editId ? "Edit" : "New"} Commissioning Inspection Request</h1>
          <p className="text-sm text-muted-foreground">Fill in the CIR submission form</p>
        </div>
      </div>

      <Form {...form}>
        <form onSubmit={form.handleSubmit((v) => mutation.mutate(v))} noValidate className="space-y-6">
          <Card>
            <CardHeader><CardTitle className="text-base">General Information</CardTitle></CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <FormItem><FormLabel>Reference Number</FormLabel><Input value={referenceNo} disabled className="font-mono bg-muted" placeholder="Select discipline to generate..." /></FormItem>
              </div>
              <FormField control={form.control} name="date" render={({ field }) => (<FormItem><FormLabel>Date</FormLabel><FormControl><DatePicker value={field.value} onChange={field.onChange} /></FormControl><FormMessage /></FormItem>)} />
              <FormField control={form.control} name="discipline_id" render={({ field }) => (
                <FormItem><FormLabel>Discipline *</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl><SelectTrigger><SelectValue placeholder="Select discipline">{disciplineId ? disciplines.find((d) => d.id === disciplineId)?.name : ""}</SelectValue></SelectTrigger></FormControl>
                    <SelectContent>{disciplines.map((d) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}</SelectContent>
                  </Select><FormMessage />
                </FormItem>
              )} />
              <div className="sm:col-span-2"><FormField control={form.control} name="subject" render={({ field }) => (<FormItem><FormLabel>Subject *</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>)} /></div>
              <div className="sm:col-span-2"><FormField control={form.control} name="description" render={({ field }) => (<FormItem><FormLabel>Description *</FormLabel><FormControl><Textarea rows={3} {...field} /></FormControl><FormMessage /></FormItem>)} /></div>
              <FormField control={form.control} name="location" render={({ field }) => (<FormItem><FormLabel>Location</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>)} />
            </CardContent>
          </Card>

          {/* Assets */}
          <Card>
            <CardHeader><CardTitle className="text-base">Assets</CardTitle></CardHeader>
            <CardContent>
              <Select onValueChange={(v: any) => v && addAsset(v)}>
                <SelectTrigger><SelectValue placeholder="Add asset..." /></SelectTrigger>
                <SelectContent>{assets.filter((a) => !selectedAssets.find((s) => s.id === a.id)).map((a) => (<SelectItem key={a.id} value={a.id}>{a.tag_number} — {a.name}</SelectItem>))}</SelectContent>
              </Select>
              {selectedAssets.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {selectedAssets.map((a) => (<Badge key={a.id} variant="secondary" className="gap-1 pr-1">{a.tag_number}<button type="button" onClick={() => setSelectedAssets(selectedAssets.filter((x) => x.id !== a.id))} className="ml-1 hover:text-destructive"><X className="h-3 w-3" /></button></Badge>))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Commissioning Linkage */}
          <Card>
            <CardContent className="pt-6">
              <CommissioningLinkagePanel projectId={project?.id || ""} selectedAssetIds={selectedAssets.map((a) => a.id)} documentType="CIR" value={commissioningLinkage} onChange={setCommissioningLinkage} />
            </CardContent>
          </Card>

          {/* Inspectors */}
          <Card>
            <CardHeader><CardTitle className="text-base">Inspected By</CardTitle></CardHeader>
            <CardContent>
              <div className="grid gap-4 sm:grid-cols-2">
                {[{ key: "inspector_1_id" as const, label: "Inspected by 1", signKey: "inspector1" as const }, { key: "inspector_2_id" as const, label: "Inspected by 2", signKey: "inspector2" as const }].map(({ key, label, signKey }) => {
                  const inspId = form.watch(key);
                  return (
                    <div key={key} className="space-y-3">
                      <FormField control={form.control} name={key} render={({ field }) => (
                        <FormItem><FormLabel>{label}</FormLabel>
                          <Select onValueChange={field.onChange} value={field.value}>
                            <FormControl><SelectTrigger><SelectValue placeholder="Select">{inspId ? users.find((u) => u.id === inspId)?.full_name : ""}</SelectValue></SelectTrigger></FormControl>
                            <SelectContent>{users.map((u) => (<SelectItem key={u.id} value={u.id}>{u.full_name}: {u.position || "—"}</SelectItem>))}</SelectContent>
                          </Select>
                        </FormItem>
                      )} />
                      <div className={`h-16 rounded-md border-2 border-dashed flex items-center justify-center transition-colors ${signed[signKey] ? "border-emerald-500/50 bg-emerald-500/5" : currentUser?.id === inspId ? "border-border hover:border-primary/50 cursor-pointer" : "border-border opacity-50"}`}
                        onClick={() => { if (currentUser?.id === inspId) setSigned((s) => ({ ...s, [signKey]: !s[signKey] })); }}>
                        {signed[signKey] ? (
                          <img src={`${api.defaults.baseURL}/reports/signature-preview?name=${encodeURIComponent((() => { const u = users.find((u) => u.id === inspId); return u?.signature_text || u?.full_name || ""; })())}&font_id=${users.find((u) => u.id === inspId)?.signature_font || "dancing_script"}&color=%2316a34a`} alt="Signature" className="h-10 object-contain" />
                        ) : (<span className="text-sm text-muted-foreground">{currentUser?.id === inspId ? "Click to sign" : "Awaiting signature"}</span>)}
                      </div>
                      {currentUser?.id === inspId && <Link href="/profile" className="text-xs text-primary hover:underline inline-flex items-center gap-1"><PenLine className="h-3 w-3" />Change signature style</Link>}
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>

          {/* Actions */}
          <div className="flex justify-end gap-3">
            <Button type="button" variant="outline" onClick={() => router.push("/qaqc/cir")}>Cancel</Button>
            <Button type="submit" variant="secondary" disabled={mutation.isPending}>{mutation.isPending ? "Saving..." : "Save as Draft"}</Button>
          </div>
        </form>
      </Form>
    </div>
  );
}
