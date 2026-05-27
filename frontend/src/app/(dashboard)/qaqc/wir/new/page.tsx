"use client";

import { useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { z } from "zod/v4";
import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowLeft, GripVertical, Plus, Trash2, X, Send, PenLine } from "lucide-react";
import api from "@/lib/api";
import { useSelectedProject } from "@/hooks/use-project";
import { useCurrentUser } from "@/hooks/use-auth";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DatePicker } from "@/components/ui/date-picker";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Form, FormField, FormItem, FormLabel, FormControl, FormMessage } from "@/components/form";
import { CommissioningLinkagePanel, type CommissioningLinkage } from "@/components/commissioning-linkage";
import { ApprovalChain } from "@/components/approval-chain";

interface Discipline { id: string; name: string; code: string; }
interface User { id: string; full_name: string; position: string | null; signature_text: string | null; signature_font: string | null; }
interface Asset { id: string; name: string; tag_number: string; }

const schema = z.object({
  subject: z.string().min(1, "Subject is required"),
  discipline_id: z.string().min(1, "Discipline is required"),
  description: z.string().min(1, "Description is required"),
  general_location: z.string().optional(),
  floor_level_room: z.string().optional(),
  approved_rams: z.string().optional(),
  drawing_reference: z.string().optional(),
  inspector_1_id: z.string().optional(),
  inspector_2_id: z.string().optional(),
  date: z.string().optional(),
});

type FormValues = z.infer<typeof schema>;

export default function NewWIRPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const editId = searchParams.get("id");
  const project = useSelectedProject();
  const { data: currentUser } = useCurrentUser();
  const queryClient = useQueryClient();
  const [selectedAssets, setSelectedAssets] = useState<Asset[]>([]);
  const [attachments, setAttachments] = useState<{ name: string; path: string }[]>([]);
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

  const { data: assets = [] } = useQuery<Asset[]>({
    queryKey: ["assets"],
    queryFn: async () => (await api.get("/assets")).data,
  });

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      subject: "",
      discipline_id: "",
      description: "",
      general_location: "",
      floor_level_room: "",
      approved_rams: "",
      drawing_reference: "",
      inspector_1_id: "",
      inspector_2_id: "",
      date: new Date().toISOString().split("T")[0],
    },
  });

  // Load existing document if editing
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
        general_location: existingDoc.location || "",
        floor_level_room: existingDoc.floor_level || "",
        approved_rams: existingDoc.rams_ref || "",
        drawing_reference: existingDoc.drawing_ref || "",
        inspector_1_id: existingDoc.site_engineer_id || "",
        inspector_2_id: existingDoc.qaqc_engineer_id || "",
        date: existingDoc.inspection_date ? existingDoc.inspection_date.split("T")[0] : "",
      });
      setSigned({
        inspector1: !!existingDoc.site_engineer_signed,
        inspector2: !!existingDoc.qaqc_engineer_signed,
      });
      setReferenceNo(existingDoc.reference_no || "");
    }
  }, [existingDoc]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-generate reference number for new WIR when discipline is selected
  const disciplineId = form.watch("discipline_id");
  useEffect(() => {
    if (!editId && disciplineId && project?.id && disciplines.length > 0) {
      const disciplineCode = disciplines.find((d) => d.id === disciplineId)?.code || "";
      api.get("/documents/generate-ref-number", {
        params: { project_id: project.id, doc_type: "WIR", discipline_code: disciplineCode },
      }).then((res) => setReferenceNo(res.data.reference_number))
        .catch(() => {});
    }
  }, [editId, disciplineId, project?.id, disciplines.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const inspector1Id = form.watch("inspector_1_id");
  const inspector2Id = form.watch("inspector_2_id");

  const buildPayload = (values: FormValues, refNo?: string) => ({
    project_id: project!.id,
    document_type: "WIR",
    reference_no: refNo || referenceNo || "",
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
    site_engineer_signed: signed.inspector1,
    qaqc_engineer_signed: signed.inspector2,
    asset_ids: selectedAssets.map((a) => a.id),
  });

  const mutation = useMutation({
    mutationFn: async (values: FormValues) => {
      let res;
      if (editId) {
        const { project_id, document_type, reference_no, ...updatePayload } = buildPayload(values);
        res = await api.patch(`/documents/${editId}`, updatePayload);
      } else {
        res = await api.post("/documents", buildPayload(values));
      }
      const docId = res.data?.id || editId;
      // Save commissioning linkage for all assets
      if (commissioningLinkage && docId && selectedAssets.length > 0) {
        for (const asset of selectedAssets) {
          const arRes = await api.get("/commissioning/asset-requirements", { params: { asset_id: asset.id } });
          const assetReq = (arRes.data as any[]).find(
            (ar: any) => ar.requirement_template_id === commissioningLinkage.requirementTemplateId
          );
          if (!assetReq) continue;

          if (commissioningLinkage.isPartialScope) {
            // Delete marked items
            for (const delId of commissioningLinkage.deleteExistingIds) {
              await api.patch(`/commissioning/work-items/${delId}`, { status: "not_started" });
              // Soft-delete by marking — or we could add a delete endpoint
            }
            // Create new items (all of them, checked or not)
            const createdIds: string[] = [];
            for (let i = 0; i < commissioningLinkage.newItems.length; i++) {
              const wiRes = await api.post("/commissioning/work-items", {
                asset_requirement_id: assetReq.id,
                name: commissioningLinkage.newItems[i].name,
                sequence_no: i + 100,
                created_dynamically: true,
              });
              if (commissioningLinkage.newItems[i].checked) {
                createdIds.push(wiRes.data.id);
              }
            }
            // Link checked existing items to this document
            for (const wiId of commissioningLinkage.checkedExistingIds) {
              await api.post("/commissioning/document-links", {
                document_id: docId,
                asset_requirement_id: assetReq.id,
                requirement_work_item_id: wiId,
              });
            }
            // Link checked new items to this document
            for (const wiId of createdIds) {
              await api.post("/commissioning/document-links", {
                document_id: docId,
                asset_requirement_id: assetReq.id,
                requirement_work_item_id: wiId,
              });
            }
          } else {
            // Full scope - link document directly to requirement
            await api.post("/commissioning/document-links", {
              document_id: docId,
              asset_requirement_id: assetReq.id,
            });
          }
        }
      }
      return res;
    },
    onSuccess: () => {
      toast.success(editId ? "WIR updated" : "WIR saved as draft");
      queryClient.invalidateQueries({ queryKey: ["documents", "WIR"] });
      router.push("/qaqc/wir");
    },
  });

  const notifyMutation = useMutation({
    mutationFn: async (values: FormValues) => {
      let docId = editId;
      if (!docId) {
        const res = await api.post("/documents", buildPayload(values));
        docId = res.data.id;
      } else {
        const { project_id, document_type, reference_no, ...updatePayload } = buildPayload(values);
        await api.patch(`/documents/${docId}`, updatePayload);
      }
      await api.post(`/documents/${docId}/notify-signatories`);
    },
    onSuccess: () => {
      toast.success("WIR saved and signatories notified");
      queryClient.invalidateQueries({ queryKey: ["documents", "WIR"] });
      router.push("/qaqc/wir");
    },
  });

  const handleBack = () => {
    if (form.formState.isDirty) {
      if (confirm("You have unsaved changes. Save as draft before leaving?")) {
        form.handleSubmit((v) => mutation.mutate(v))();
        return;
      }
    }
    router.push("/qaqc/wir");
  };

  const addAsset = (assetId: string) => {
    const asset = assets.find((a) => a.id === assetId);
    if (asset && !selectedAssets.find((a) => a.id === assetId)) {
      setSelectedAssets([...selectedAssets, asset]);
    }
  };

  const removeAsset = (assetId: string) => {
    setSelectedAssets(selectedAssets.filter((a) => a.id !== assetId));
  };

  const addAttachment = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = true;
    input.onchange = (e) => {
      const files = (e.target as HTMLInputElement).files;
      if (files) {
        const newAttachments = Array.from(files).map((f) => ({ name: f.name, path: f.name }));
        setAttachments([...attachments, ...newAttachments]);
      }
    };
    input.click();
  };

  const removeAttachment = (index: number) => {
    setAttachments(attachments.filter((_, i) => i !== index));
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="sm" onClick={handleBack}>
          <ArrowLeft className="h-4 w-4 mr-1" />Back
        </Button>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{editId ? "Edit Work Inspection Request" : "New Work Inspection Request"}</h1>
          <p className="text-sm text-muted-foreground">Fill in the WIR submission form</p>
        </div>
      </div>

      <Form {...form}>
        <form onSubmit={form.handleSubmit((v) => mutation.mutate(v))} noValidate className="space-y-6">

          {/* Basic Info */}
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
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl><SelectTrigger><SelectValue placeholder="Select discipline">{disciplineId ? disciplines.find((d) => d.id === disciplineId)?.name : ""}</SelectValue></SelectTrigger></FormControl>
                    <SelectContent>{disciplines.map((d) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}</SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />
              <div className="sm:col-span-2">
                <FormField control={form.control} name="subject" render={({ field }) => (
                  <FormItem><FormLabel>Subject *</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
                )} />
              </div>
              <div className="sm:col-span-2">
                <FormField control={form.control} name="description" render={({ field }) => (
                  <FormItem><FormLabel>Description of Inspection *</FormLabel><FormControl><Textarea rows={3} {...field} /></FormControl><FormMessage /></FormItem>
                )} />
              </div>
              <FormField control={form.control} name="general_location" render={({ field }) => (
                <FormItem><FormLabel>General Location</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="floor_level_room" render={({ field }) => (
                <FormItem><FormLabel>Floor / Level / Room</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="approved_rams" render={({ field }) => (
                <FormItem><FormLabel>Approved RAMS</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="drawing_reference" render={({ field }) => (
                <FormItem><FormLabel>Drawing Reference</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
              )} />
            </CardContent>
          </Card>

          {/* Assets */}
          <Card>
            <CardHeader><CardTitle className="text-base">Assets</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div>
                <FormLabel>Select Assets</FormLabel>
                <div className="mt-2 flex gap-2">
                  <Select onValueChange={(v) => v && addAsset(v as string)}>
                    <SelectTrigger className="flex-1"><SelectValue placeholder="Add asset..." /></SelectTrigger>
                    <SelectContent>
                      {assets.filter((a) => !selectedAssets.find((s) => s.id === a.id)).map((a) => (
                        <SelectItem key={a.id} value={a.id}>{a.tag_number} — {a.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {selectedAssets.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {selectedAssets.map((asset) => (
                      <Badge key={asset.id} variant="secondary" className="gap-1 pr-1">
                        {asset.tag_number}
                        <button type="button" onClick={() => removeAsset(asset.id)} className="ml-1 hover:text-destructive">
                          <X className="h-3 w-3" />
                        </button>
                      </Badge>
                    ))}
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Commissioning Linkage (optional) */}
          <Card>
            <CardContent className="pt-6">
              <CommissioningLinkagePanel
                projectId={project?.id || ""}
                selectedAssetIds={selectedAssets.map((a) => a.id)}
                documentType="WIR"
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
                      <FormLabel>Inspected by 1</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl><SelectTrigger className="w-full min-w-[280px]"><SelectValue placeholder="Name and Designation">{inspector1Id ? `${users.find((u) => u.id === inspector1Id)?.full_name || ""}` : ""}</SelectValue></SelectTrigger></FormControl>
                        <SelectContent>
                          {users.map((u) => (
                            <SelectItem key={u.id} value={u.id}>
                              <span className="inline-flex items-baseline gap-2 w-full">
                                <span>{u.full_name}:</span>
                                <span className="text-muted-foreground">{u.position || "—"}</span>
                              </span>
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
                    onClick={() => {
                      if (currentUser?.id === inspector1Id) setSigned((s) => ({ ...s, inspector1: !s.inspector1 }));
                    }}
                  >
                    {signed.inspector1 ? (
                      <img
                        src={`${api.defaults.baseURL}/reports/signature-preview?name=${encodeURIComponent((() => { const u = users.find((u) => u.id === inspector1Id); return u?.signature_text || u?.full_name || ""; })())}&font_id=${users.find((u) => u.id === inspector1Id)?.signature_font || "dancing_script"}&color=%2316a34a`}
                        alt="Signature"
                        className="h-10 object-contain"
                      />
                    ) : (
                      <span className="text-sm text-muted-foreground">
                        {currentUser?.id === inspector1Id ? "Click to sign" : "Awaiting signature"}
                      </span>
                    )}
                  </div>
                  {currentUser?.id === inspector1Id && (
                    <Link href="/profile" className="text-xs text-primary hover:underline inline-flex items-center gap-1">
                      <PenLine className="h-3 w-3" />Change signature style
                    </Link>
                  )}
                </div>
                <div className="space-y-3">
                  <FormField control={form.control} name="inspector_2_id" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Inspected by 2</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl><SelectTrigger className="w-full min-w-[280px]"><SelectValue placeholder="Name and Designation">{inspector2Id ? `${users.find((u) => u.id === inspector2Id)?.full_name || ""}` : ""}</SelectValue></SelectTrigger></FormControl>
                        <SelectContent>
                          {users.map((u) => (
                            <SelectItem key={u.id} value={u.id}>
                              <span className="inline-flex items-baseline gap-2 w-full">
                                <span>{u.full_name}:</span>
                                <span className="text-muted-foreground">{u.position || "—"}</span>
                              </span>
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
                    onClick={() => {
                      if (currentUser?.id === inspector2Id) setSigned((s) => ({ ...s, inspector2: !s.inspector2 }));
                    }}
                  >
                    {signed.inspector2 ? (
                      <img
                        src={`${api.defaults.baseURL}/reports/signature-preview?name=${encodeURIComponent((() => { const u = users.find((u) => u.id === inspector2Id); return u?.signature_text || u?.full_name || ""; })())}&font_id=${users.find((u) => u.id === inspector2Id)?.signature_font || "dancing_script"}&color=%2316a34a`}
                        alt="Signature"
                        className="h-10 object-contain"
                      />
                    ) : (
                      <span className="text-sm text-muted-foreground">
                        {currentUser?.id === inspector2Id ? "Click to sign" : "Awaiting signature"}
                      </span>
                    )}
                  </div>
                  {currentUser?.id === inspector2Id && (
                    <Link href="/profile" className="text-xs text-primary hover:underline inline-flex items-center gap-1">
                      <PenLine className="h-3 w-3" />Change signature style
                    </Link>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Attachments */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-base">Attachments</CardTitle>
              <Button type="button" variant="outline" size="sm" onClick={addAttachment}>
                <Plus className="h-4 w-4 mr-1" />Add Files
              </Button>
            </CardHeader>
            <CardContent>
              {attachments.length === 0 ? (
                <p className="text-sm text-muted-foreground">No attachments added yet.</p>
              ) : (
                <div className="space-y-2">
                  {attachments.map((att, i) => (
                    <div
                      key={i}
                      draggable
                      onDragStart={(e) => e.dataTransfer.setData("text/plain", String(i))}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={(e) => {
                        e.preventDefault();
                        const from = Number(e.dataTransfer.getData("text/plain"));
                        if (from === i) return;
                        const items = [...attachments];
                        const [moved] = items.splice(from, 1);
                        items.splice(i, 0, moved);
                        setAttachments(items);
                      }}
                      className="flex items-center gap-3 rounded-md border border-border px-3 py-2 transition-colors hover:bg-accent/50"
                    >
                      <GripVertical className="h-4 w-4 text-muted-foreground cursor-grab active:cursor-grabbing" />
                      <span className="flex-1 text-sm truncate">{att.name}</span>
                      <button type="button" onClick={() => removeAttachment(i)} className="text-muted-foreground hover:text-destructive">
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Actions */}
          <div className="flex justify-end gap-3">
            <Button type="button" variant="outline" onClick={handleBack}>Cancel</Button>
            <Button type="submit" variant="secondary" disabled={mutation.isPending}>
              {mutation.isPending ? "Saving..." : "Save as Draft"}
            </Button>
            <Button type="button" disabled={notifyMutation.isPending || !inspector1Id || !inspector2Id} onClick={form.handleSubmit((v) => notifyMutation.mutate(v))}>
              <Send className="h-4 w-4 mr-2" />{notifyMutation.isPending ? "Sending..." : "Save & Notify Signatories"}
            </Button>
          </div>
        </form>
      </Form>

      {/* Approval Chain (shown when editing a submitted document) */}
      {editId && existingDoc && existingDoc.status !== "draft" && (
        <Card>
          <CardContent className="pt-6">
            <ApprovalChain documentId={editId} documentStatus={existingDoc.status} />
            {existingDoc.status === "rejected" && (
              <div className="mt-4 pt-4 border-t">
                <Button
                  variant="default"
                  onClick={async () => {
                    const res = await api.post(`/documents/${editId}/resubmit`);
                    toast.success(`Resubmitted as revision ${res.data.revision_no}`);
                    router.push(`/qaqc/wir/new?id=${res.data.id}`);
                  }}
                >
                  Resubmit as New Revision
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
