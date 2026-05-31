"use client";

import { useState, useEffect, useRef, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTheme } from "next-themes";
import { useForm } from "react-hook-form";
import { z } from "zod/v4";
import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowLeft, Loader2, X, Send, PenLine, Download, ChevronDown } from "lucide-react";
import api from "@/lib/api";
import { useSelectedProject } from "@/hooks/use-project";
import { useCurrentUser } from "@/hooks/use-auth";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DatePicker } from "@/components/ui/date-picker";
import { TimePicker } from "@/components/ui/time-picker";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Form, FormField, FormItem, FormLabel, FormControl, FormMessage } from "@/components/form";
import { CommissioningLinkagePanel, type CommissioningLinkage } from "@/components/commissioning-linkage";
import { ApprovalActionPanel } from "@/components/approval/approval-action-panel";
import { DocumentAttachments } from "@/components/document-attachments";

interface Discipline { id: string; name: string; code: string; }
interface User { id: string; full_name: string; designation: { id: string; name: string } | null; signature_text: string | null; signature_font: string | null; }
interface Asset { id: string; name: string; tag_number: string; asset_type_id: string; }
interface AssetType { id: string; name: string; code: string; service_id: string; parent_type_id: string | null; }
interface Service { id: string; name: string; code: string; discipline_id: string; }

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
  remarks_1: z.string().optional(),
  remarks_2: z.string().optional(),
  inspector_date_1: z.string().optional(),
  inspector_time_1: z.string().optional(),
  inspector_date_2: z.string().optional(),
  inspector_time_2: z.string().optional(),
  date: z.string().optional(),
});

type FormValues = z.infer<typeof schema>;

export default function NewCIRPage() {
  return (
    <Suspense fallback={<div className="p-8 text-center text-muted-foreground">Loading...</div>}>
      <NewCIRPageInner />
    </Suspense>
  );
}

function NewCIRPageInner() {
  const searchParams = useSearchParams();
  const editId = searchParams.get("id");
  return <NewCIRPageContent key={editId || "new"} />;
}


function NewCIRPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const editId = searchParams.get("id");
  const project = useSelectedProject();
  const { data: currentUser } = useCurrentUser();
  const queryClient = useQueryClient();
  const { resolvedTheme } = useTheme();
  const sigColor = resolvedTheme === "dark" ? "%23f8fafc" : "%230f172a";
  const [selectedAssets, setSelectedAssets] = useState<Asset[]>([]);
  const [assetTypeFilter, setAssetTypeFilter] = useState<string>("");
  const [assetSearch, setAssetSearch] = useState("");
  const [assetsOpen, setAssetsOpen] = useState(false);
  const [confirmDisableLinkage, setConfirmDisableLinkage] = useState(false);
  const [attachments, setAttachments] = useState<{ id?: string; file?: File; name: string; size: number; isExisting?: boolean; insert_after_page?: number | null }[]>([]);
  const [signed, setSigned] = useState<{ inspector1: boolean; inspector2: boolean }>({ inspector1: false, inspector2: false });
  const [commissioningLinkage, setCommissioningLinkage] = useState<CommissioningLinkage | null>(null);
  const linkageDirtyRef = useRef(false);
  const [referenceNo, setReferenceNo] = useState<string>("");
  const [revisionNo, setRevisionNo] = useState<number>(0);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>("");
  const [isDirty, setIsDirty] = useState(!editId);
  const [submissionMode, setSubmissionMode] = useState<"new" | "revision">("new");
  const [revisionOfId, setRevisionOfId] = useState<string | null>(null);
  const [savedSignatories, setSavedSignatories] = useState<{ inspector1: string; inspector2: string }>({ inspector1: "", inspector2: "" });

  const { data: disciplines = [] } = useQuery<Discipline[]>({ queryKey: ["disciplines"], queryFn: async () => (await api.get("/disciplines")).data });
  const { data: users = [] } = useQuery<User[]>({ queryKey: ["users"], queryFn: async () => (await api.get("/auth/users")).data });
  const { data: assets = [] } = useQuery<Asset[]>({ queryKey: ["assets", project?.id], queryFn: async () => (await api.get("/assets", { params: { project_id: project?.id } })).data, enabled: !!project?.id });
  const { data: services = [] } = useQuery<Service[]>({ queryKey: ["services"], queryFn: async () => (await api.get("/services")).data });
  const { data: assetTypes = [] } = useQuery<AssetType[]>({ queryKey: ["asset-types"], queryFn: async () => (await api.get("/asset-types")).data });

  const { data: docTemplates = [] } = useQuery<{ id: string; name: string; version: number; is_active: boolean }[]>({
    queryKey: ["doc-templates", project?.id, "CIR"],
    queryFn: async () => (await api.get("/reports/templates", { params: { project_id: project!.id, doc_type: "CIR" } })).data,
    enabled: !!project?.id,
  });

  useEffect(() => { if (docTemplates.length > 0) { const current = docTemplates.find((t) => t.id === selectedTemplateId); if (!current) { const active = docTemplates.find((t) => t.is_active); setSelectedTemplateId(active?.id || docTemplates[0].id); } } }, [docTemplates]); // eslint-disable-line react-hooks/exhaustive-deps

  const { data: allAssetRequirements = [] } = useQuery<{ id: string; asset_id: string; requirement_template_id: string; status: string }[]>({
    queryKey: ["asset-requirements-all", project?.id],
    queryFn: async () => (await api.get("/commissioning/asset-requirements", { params: { project_id: project?.id } })).data,
    enabled: !!project?.id,
  });

  const { data: rejectedDocs = {} } = useQuery<Record<string, { id: string; reference_no: string; revision_no: number; title: string; document_type: string; discipline_id: string | null }[]>>({
    queryKey: ["rejected-for-revision", project?.id, "CIR"],
    queryFn: async () => (await api.get("/documents/rejected-for-revision", { params: { project_id: project?.id, document_type: "CIR" } })).data,
    enabled: !!project?.id && !editId && submissionMode === "revision",
  });

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { subject: "", discipline_id: "", description: "", general_location: "", floor_level_room: "", approved_rams: "", drawing_reference: "", inspector_1_id: "", inspector_2_id: "", remarks_1: "", remarks_2: "", inspector_date_1: "", inspector_time_1: "", inspector_date_2: "", inspector_time_2: "", date: new Date().toISOString().split("T")[0] },
  });

  const { data: existingDoc } = useQuery({ queryKey: ["document", editId], queryFn: async () => (await api.get(`/documents/${editId}`)).data, enabled: !!editId });

  const formLocked = !!existingDoc && ["with_approver_1", "approver_1_returned", "with_approver_2", "approved", "approved_with_comments", "rejected", "superseded"].includes(existingDoc.status);
  const fullyLocked = !!existingDoc && ["with_approver_1", "approver_1_returned", "with_approver_2", "approved", "approved_with_comments", "rejected", "superseded"].includes(existingDoc.status);

  useEffect(() => { if (fullyLocked && selectedAssets.length > 0) setAssetsOpen(false); }, [fullyLocked, selectedAssets.length]); // eslint-disable-line react-hooks/exhaustive-deps


  useEffect(() => {
    if (existingDoc) {
      form.reset({
        subject: existingDoc.title || "", discipline_id: existingDoc.discipline_id || "", description: existingDoc.description || "",
        general_location: existingDoc.location || "", floor_level_room: existingDoc.floor_level || "", approved_rams: existingDoc.rams_ref || "",
        drawing_reference: existingDoc.drawing_ref || "", inspector_1_id: existingDoc.site_engineer_id || "", inspector_2_id: existingDoc.qaqc_engineer_id || "",
        remarks_1: existingDoc.remarks_1 || "", remarks_2: existingDoc.remarks_2 || "",
        inspector_date_1: existingDoc.inspector_date_1 || "", inspector_time_1: existingDoc.inspector_time_1 || "",
        inspector_date_2: existingDoc.inspector_date_2 || "", inspector_time_2: existingDoc.inspector_time_2 || "",
        date: existingDoc.inspection_date ? existingDoc.inspection_date.split("T")[0] : "",
      });
      setSigned({ inspector1: !!existingDoc.site_engineer_signed, inspector2: !!existingDoc.qaqc_engineer_signed });
      setReferenceNo(existingDoc.reference_no || "");
      setRevisionNo(existingDoc.revision_no || 0);
      setSavedSignatories({ inspector1: existingDoc.site_engineer_id || "", inspector2: existingDoc.qaqc_engineer_id || "" });
      if (existingDoc.asset_ids?.length && assets.length > 0) {
        const ids = new Set(existingDoc.asset_ids);
        setSelectedAssets(assets.filter((a) => ids.has(a.id)));
      }
    }
  }, [existingDoc, assets.length]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!editId || allAssetRequirements.length === 0 || commissioningLinkage) return;
    api.get("/commissioning/document-links", { params: { document_id: editId } }).then(async (res) => {
      const links = res.data as { asset_requirement_id: string; requirement_work_item_id: string | null }[];
      if (links.length === 0) return;
      const firstArId = links[0].asset_requirement_id;
      const ar = allAssetRequirements.find((r) => r.id === firstArId);
      if (!ar) return;
      const hasWorkItems = links.some((l) => l.requirement_work_item_id != null);
      let isPartial = hasWorkItems;
      if (!isPartial) { const wiRes = await api.get("/commissioning/work-items", { params: { asset_requirement_id: firstArId } }); isPartial = wiRes.data.length > 0; }
      setCommissioningLinkage({ requirementTemplateId: ar.requirement_template_id, isPartialScope: isPartial, checkedExistingIds: links.filter((l) => l.requirement_work_item_id).map((l) => l.requirement_work_item_id!), deleteExistingIds: [], newItems: [] });
    }).catch(() => {});
  }, [editId, allAssetRequirements.length]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { if (editId) { api.get(`/documents/${editId}/attachments`).then((res) => { setAttachments(res.data.map((a: any) => ({ id: a.id, name: a.filename, size: a.size, isExisting: true }))); }).catch(() => {}); } }, [editId]);

  // Pre-fill from rejected document for revision
  useEffect(() => {
    if (!revisionOfId || editId) return;
    (async () => {
      try {
        const { data: doc } = await api.get(`/documents/${revisionOfId}`);
        form.reset({
          subject: doc.title || "", discipline_id: doc.discipline_id || "", description: doc.description || "",
          general_location: doc.location || "", floor_level_room: doc.floor_level || "", approved_rams: doc.rams_ref || "",
          drawing_reference: doc.drawing_ref || "", inspector_1_id: doc.site_engineer_id || "", inspector_2_id: doc.qaqc_engineer_id || "",
          remarks_1: doc.remarks_1 || "", remarks_2: doc.remarks_2 || "",
          inspector_date_1: doc.inspector_date_1 || "", inspector_time_1: doc.inspector_time_1 || "",
          inspector_date_2: doc.inspector_date_2 || "", inspector_time_2: doc.inspector_time_2 || "",
          date: new Date().toISOString().split("T")[0],
        });
        setReferenceNo(doc.reference_no || "");
        setRevisionNo(doc.revision_no + 1);
        if (doc.asset_ids?.length && assets.length > 0) { const ids = new Set(doc.asset_ids); setSelectedAssets(assets.filter((a: Asset) => ids.has(a.id))); }
        const linksRes = await api.get("/commissioning/document-links", { params: { document_id: revisionOfId } });
        const links = linksRes.data as { asset_requirement_id: string; requirement_work_item_id: string | null }[];
        if (links.length > 0) {
          const ar = allAssetRequirements.find((r) => r.id === links[0].asset_requirement_id);
          if (ar) { setCommissioningLinkage({ requirementTemplateId: ar.requirement_template_id, isPartialScope: links.some((l) => l.requirement_work_item_id != null), checkedExistingIds: links.filter((l) => l.requirement_work_item_id).map((l) => l.requirement_work_item_id!), deleteExistingIds: [], newItems: [] }); linkageDirtyRef.current = true; }
        }
        setIsDirty(true);
      } catch { toast.error("Failed to load rejected document data"); }
    })();
  }, [revisionOfId, assets.length, allAssetRequirements.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const disciplineId = form.watch("discipline_id");
  const applicableTemplateIds = (() => {
    if (!disciplineId) return null;
    const disciplineTypeIds = new Set(assetTypes.filter((t) => { const svc = services.find((s) => s.id === t.service_id); return svc?.discipline_id === disciplineId; }).map((t) => t.id));
    const disciplineAssetIds = new Set(assets.filter((a) => disciplineTypeIds.has(a.asset_type_id)).map((a) => a.id));
    return new Set(allAssetRequirements.filter((ar) => disciplineAssetIds.has(ar.asset_id)).map((ar) => ar.requirement_template_id));
  })();
  const selectedTemplateId2 = commissioningLinkage?.requirementTemplateId;
  const applicableAssetIds = selectedTemplateId2 ? new Set(allAssetRequirements.filter((ar) => ar.requirement_template_id === selectedTemplateId2 && ar.status !== "achieved").map((ar) => ar.asset_id)) : null;

  useEffect(() => {
    if (!editId && !revisionOfId && disciplineId && project?.id && disciplines.length > 0) {
      const code = disciplines.find((d) => d.id === disciplineId)?.code || "";
      api.get("/documents/generate-ref-number", { params: { project_id: project.id, doc_type: "CIR", discipline_code: code } })
        .then((res) => setReferenceNo(res.data.reference_number)).catch(() => toast.error("Failed to generate reference number"));
    }
  }, [editId, revisionOfId, disciplineId, project?.id, disciplines.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const inspector1Id = form.watch("inspector_1_id");
  const inspector2Id = form.watch("inspector_2_id");


  const handleSign = async (role: "site_engineer" | "qaqc_engineer") => {
    if (!editId) { toast.error("Please save the document first before signing"); return; }
    try {
      await api.post(`/documents/${editId}/sign?role=${role}`);
      setSigned((s) => role === "site_engineer" ? { ...s, inspector1: true } : { ...s, inspector2: true });
      queryClient.invalidateQueries({ queryKey: ["document", editId] });
      toast.success("Signed successfully");
    } catch (e: any) { toast.error(e.response?.data?.detail || "Failed to sign"); }
  };

  const buildPayload = (values: FormValues) => ({
    project_id: project!.id, document_type: "CIR", reference_no: referenceNo || "",
    title: values.subject, description: values.description, discipline_id: values.discipline_id,
    location: values.general_location || null, floor_level: values.floor_level_room || null,
    rams_ref: values.approved_rams || null, drawing_ref: values.drawing_reference || null,
    inspection_date: values.date || null, site_engineer_id: values.inspector_1_id || null, qaqc_engineer_id: values.inspector_2_id || null,
    remarks_1: values.remarks_1 || null, remarks_2: values.remarks_2 || null,
    inspector_date_1: values.inspector_date_1 || null, inspector_time_1: values.inspector_time_1 || null,
    inspector_date_2: values.inspector_date_2 || null, inspector_time_2: values.inspector_time_2 || null,
    asset_ids: selectedAssets.map((a) => a.id),
    ...(revisionOfId ? { revision_of_id: revisionOfId } : {}),
  });

  const saveCommissioningLinkage = async (docId: string | null) => {
    if (!commissioningLinkage || !docId || selectedAssets.length === 0) return;
    for (const asset of selectedAssets) {
      const arRes = await api.get("/commissioning/asset-requirements", { params: { asset_id: asset.id } });
      const assetReq = (arRes.data as any[]).find((ar: any) => ar.requirement_template_id === commissioningLinkage.requirementTemplateId);
      if (!assetReq) continue;
      if (commissioningLinkage.isPartialScope) {
        const wiListRes = await api.get("/commissioning/work-items", { params: { asset_requirement_id: assetReq.id } });
        const assetWiIds = new Set((wiListRes.data as any[]).map((wi: any) => wi.id));
        for (const delId of commissioningLinkage.deleteExistingIds) { if (assetWiIds.has(delId)) await api.delete(`/commissioning/work-items/${delId}`); }
        const createdIds: string[] = [];
        for (let i = 0; i < commissioningLinkage.newItems.length; i++) {
          const wiRes = await api.post("/commissioning/work-items", { asset_requirement_id: assetReq.id, name: commissioningLinkage.newItems[i].name, sequence_no: i + 100, created_dynamically: true });
          if (commissioningLinkage.newItems[i].checked) createdIds.push(wiRes.data.id);
        }
        for (const wiId of commissioningLinkage.checkedExistingIds) { if (!assetWiIds.has(wiId)) continue; await api.post("/commissioning/document-links", { document_id: docId, asset_requirement_id: assetReq.id, requirement_work_item_id: wiId }); }
        for (const wiId of createdIds) { await api.post("/commissioning/document-links", { document_id: docId, asset_requirement_id: assetReq.id, requirement_work_item_id: wiId }); }
      } else {
        await api.post("/commissioning/document-links", { document_id: docId, asset_requirement_id: assetReq.id });
      }
    }
    if (commissioningLinkage.gateWarningAcknowledged) {
      for (const asset of selectedAssets) {
        await api.post("/commissioning/gate-overrides", { asset_id: asset.id, document_id: docId, level_code: commissioningLinkage.gateLevelCode || "L2B", incomplete_requirements: commissioningLinkage.incompleteRequirements || [], notes: commissioningLinkage.gateOverrideNotes || null }).catch(() => {});
      }
    }
  };

  const mutation = useMutation({
    mutationFn: async (values: FormValues) => {
      let res;
      if (editId) { const { project_id, document_type, reference_no, ...p } = buildPayload(values); res = await api.patch(`/documents/${editId}`, p); }
      else { res = await api.post("/documents", buildPayload(values)); }
      const docId = res.data?.id || editId;
      if (linkageDirtyRef.current) { await saveCommissioningLinkage(docId); linkageDirtyRef.current = false; }
      const newAtts = attachments.filter((a) => !a.isExisting && a.file);
      if (newAtts.length > 0 && docId) { for (const att of newAtts) { const fd = new FormData(); fd.append("file", att.file!); const params = att.insert_after_page != null ? `?insert_after_page=${att.insert_after_page}` : ""; await api.post(`/documents/${docId}/attachments${params}`, fd); } }
      const existingIds = attachments.filter((a) => a.isExisting && a.id).map((a) => a.id);
      if (existingIds.length > 0 && docId) { await api.patch(`/documents/${docId}/attachments/reorder`, existingIds); }
      return res;
    },
    onSuccess: (res) => {
      toast.success(editId ? "CIR updated" : "CIR saved as draft");
      setAssetSearch(""); setIsDirty(false); setRevisionOfId(null);
      if (res?.data?.revision_no !== undefined) setRevisionNo(res.data.revision_no);
      form.reset(form.getValues());
      queryClient.invalidateQueries({ queryKey: ["documents", "CIR"] });
      const docId = res?.data?.id || editId;
      if (docId) api.get(`/documents/${docId}/attachments`).then((r) => { setAttachments(r.data.map((a: any) => ({ id: a.id, name: a.filename, size: a.size, isExisting: true }))); }).catch(() => {});
      if (!editId && res?.data?.id) router.replace(`/qaqc/cir/new?id=${res.data.id}`);
    },
  });

  const notifyMutation = useMutation({
    mutationFn: async () => {
      await api.post(`/documents/${editId}/notify-signatories`);
    },
    onSuccess: () => { toast.success("Signatories notified"); },
  });

  const handleBack = () => { if (form.formState.isDirty) { if (confirm("You have unsaved changes. Save as draft before leaving?")) { form.handleSubmit((v) => mutation.mutate(v))(); return; } } router.push("/qaqc/cir"); };
  const addAsset = (id: string) => { const a = assets.find((x) => x.id === id); if (a && !selectedAssets.find((x) => x.id === id)) { setSelectedAssets([...selectedAssets, a]); setIsDirty(true); } };
  const removeAsset = (id: string) => { setSelectedAssets(selectedAssets.filter((a) => a.id !== id)); setIsDirty(true); };


  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="sm" onClick={handleBack}><ArrowLeft className="h-4 w-4 mr-1" />Back</Button>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{editId ? "Edit" : "New"} Commissioning Inspection Request</h1>
          <p className="text-sm text-muted-foreground">Fill in the CIR submission form</p>
        </div>
      </div>

      <Form {...form}>
        <form onSubmit={form.handleSubmit((v) => mutation.mutate(v), () => toast.error("Please fill in all required fields"))} noValidate className="space-y-6">

          {!editId && (
            <Card>
              <CardContent className="pt-6 space-y-4">
                <div className="flex items-center gap-6">
                  <label className="flex items-center gap-2 cursor-pointer"><input type="radio" name="submission_mode" checked={submissionMode === "new"} onChange={() => { setSubmissionMode("new"); setRevisionOfId(null); setRevisionNo(0); setReferenceNo(""); }} className="h-4 w-4" /><span className="text-sm font-medium">New Submission</span></label>
                  <label className="flex items-center gap-2 cursor-pointer"><input type="radio" name="submission_mode" checked={submissionMode === "revision"} onChange={() => setSubmissionMode("revision")} className="h-4 w-4" /><span className="text-sm font-medium">Revision</span></label>
                </div>
                {submissionMode === "revision" && (
                  <div className="space-y-2">
                    <FormLabel>Select Rejected Document</FormLabel>
                    <Select value={revisionOfId || ""} onValueChange={(v: string) => setRevisionOfId(v)}>
                      <SelectTrigger><SelectValue placeholder="Select a rejected document to revise">{(() => { for (const docs of Object.values(rejectedDocs)) { const d = docs.find((d) => d.id === revisionOfId); if (d) return `${d.reference_no} (Rev ${d.revision_no}) - ${d.title}`; } return ""; })()}</SelectValue></SelectTrigger>
                      <SelectContent>
                        {Object.entries(rejectedDocs).map(([discipline, docs]) => (<div key={discipline}><div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground">{discipline}</div>{docs.map((doc) => (<SelectItem key={doc.id} value={doc.id}>{doc.reference_no} (Rev {doc.revision_no}) - {doc.title}</SelectItem>))}</div>))}
                        {Object.keys(rejectedDocs).length === 0 && <div className="px-2 py-3 text-sm text-muted-foreground text-center">No rejected documents available</div>}
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          <fieldset disabled={formLocked} className="disabled:opacity-60 disabled:pointer-events-none">
          <Card>
            <CardHeader><CardTitle className="text-base">General Information</CardTitle></CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <div>
                <FormItem><FormLabel>Reference Number</FormLabel>
                  <div className="flex gap-2">
                    <Input value={referenceNo} disabled className="font-mono bg-muted flex-1" placeholder="Select discipline to generate..." />
                    {(revisionNo > 0 || editId) && <div className="flex items-center px-3 rounded-md border bg-muted text-sm font-mono whitespace-nowrap">Rev {revisionNo}</div>}
                  </div>
                </FormItem>
              </div>
              <div>
                <FormItem><FormLabel>Template</FormLabel>
                  <Select value={selectedTemplateId || (docTemplates.length === 1 ? docTemplates[0].id : "")} onValueChange={(v: any) => { setSelectedTemplateId(v); setIsDirty(true); }} disabled={docTemplates.length <= 1}>
                    <SelectTrigger><SelectValue placeholder="Select template">{(() => { const t = docTemplates.find((t) => t.id === (selectedTemplateId || (docTemplates.length === 1 ? docTemplates[0].id : ""))); return t ? `${t.name} (v${t.version})` : ""; })()}</SelectValue></SelectTrigger>
                    <SelectContent>{docTemplates.map((t) => <SelectItem key={t.id} value={t.id}>{t.name} (v{t.version}){t.is_active ? " ✓" : ""}</SelectItem>)}</SelectContent>
                  </Select>
                </FormItem>
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
              <div className="sm:col-span-2"><FormField control={form.control} name="description" render={({ field }) => (<FormItem><FormLabel>Description of Inspection *</FormLabel><FormControl><Textarea rows={3} {...field} /></FormControl><FormMessage /></FormItem>)} /></div>
              <FormField control={form.control} name="general_location" render={({ field }) => (<FormItem><FormLabel>General Location</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>)} />
              <FormField control={form.control} name="floor_level_room" render={({ field }) => (<FormItem><FormLabel>Floor / Level / Room</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>)} />
              <FormField control={form.control} name="approved_rams" render={({ field }) => (<FormItem><FormLabel>Approved RAMS</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>)} />
              <FormField control={form.control} name="drawing_reference" render={({ field }) => (<FormItem><FormLabel>Drawing Reference</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>)} />
            </CardContent>
          </Card>
          </fieldset>


          <Card><CardContent className="pt-6">
            <CommissioningLinkagePanel projectId={project?.id || ""} selectedAssetIds={selectedAssets.map((a) => a.id)} selectedAssetLabels={Object.fromEntries(selectedAssets.map((a) => [a.id, a.tag_number]))} documentType="CIR" applicableTemplateIds={applicableTemplateIds} value={commissioningLinkage}
              onChange={(linkage) => { if (!linkage && selectedAssets.length > 0) { setConfirmDisableLinkage(true); return; } setCommissioningLinkage(linkage); linkageDirtyRef.current = true; setIsDirty(true); }} />
          </CardContent></Card>

          <Card>
            <CardHeader className="cursor-pointer" onClick={() => setAssetsOpen(!assetsOpen)}>
              <CardTitle className="text-base flex items-center justify-between">Assets ({selectedAssets.length} selected)<ChevronDown className={"h-4 w-4 text-muted-foreground transition-transform " + (assetsOpen ? "rotate-180" : "")} /></CardTitle>
            </CardHeader>
            {!assetsOpen && selectedAssets.length > 0 && (
              <CardContent className="pt-0"><div className="flex flex-wrap gap-2">{selectedAssets.map((a) => (<Badge key={a.id} variant="secondary" className="gap-1 pr-1">{a.tag_number}<button type="button" onClick={() => removeAsset(a.id)} className="ml-1 hover:text-destructive"><X className="h-3 w-3" /></button></Badge>))}</div></CardContent>
            )}
            {assetsOpen && (
            <CardContent className="space-y-3">
              <div className="flex gap-2">
                <Select value={assetTypeFilter} onValueChange={(v: any) => setAssetTypeFilter(v === "__all__" ? "" : v)}>
                  <SelectTrigger className="w-48"><SelectValue placeholder="All asset types">{assetTypeFilter ? assetTypes.find((t) => t.id === assetTypeFilter)?.name : "All asset types"}</SelectValue></SelectTrigger>
                  <SelectContent><SelectItem value="__all__">All asset types</SelectItem>{assetTypes.filter((t) => { if (!disciplineId) return true; const svc = services.find((s) => s.id === t.service_id); return svc?.discipline_id === disciplineId; }).map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}</SelectContent>
                </Select>
                <Input placeholder="Search assets..." value={assetSearch} onChange={(e) => setAssetSearch(e.target.value)} className="flex-1" />
              </div>
              <div className="rounded-md border max-h-52 overflow-y-auto [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-border">
                {(() => {
                  const disciplineTypeIds = disciplineId ? new Set(assetTypes.filter((t) => { const svc = services.find((s) => s.id === t.service_id); return svc?.discipline_id === disciplineId; }).map((t) => t.id)) : null;
                  const filtered = assets.filter((a) => {
                    if (applicableAssetIds && !applicableAssetIds.has(a.id)) return false;
                    if (disciplineTypeIds && !disciplineTypeIds.has(a.asset_type_id)) return false;
                    if (assetTypeFilter && a.asset_type_id !== assetTypeFilter) return false;
                    if (assetSearch) { const q = assetSearch.toLowerCase(); if (!a.tag_number.toLowerCase().includes(q) && !a.name.toLowerCase().includes(q)) return false; }
                    return true;
                  });
                  if (filtered.length === 0) return <p className="p-3 text-sm text-muted-foreground">No assets match filters.</p>;
                  return filtered.map((a) => {
                    const isSelected = !!selectedAssets.find((s) => s.id === a.id);
                    return (<label key={a.id} className="flex items-center gap-3 px-3 py-2 hover:bg-accent/50 cursor-pointer border-b last:border-b-0"><input type="checkbox" checked={isSelected} onChange={() => isSelected ? removeAsset(a.id) : addAsset(a.id)} className="h-4 w-4 rounded border-input" /><span className="text-sm">{a.tag_number} - {a.name}</span></label>);
                  });
                })()}
              </div>
              {selectedAssets.length > 0 && (<div className="flex flex-wrap gap-2">{selectedAssets.map((a) => (<Badge key={a.id} variant="secondary" className="gap-1 pr-1">{a.tag_number}<button type="button" onClick={() => removeAsset(a.id)} className="ml-1 hover:text-destructive"><X className="h-3 w-3" /></button></Badge>))}</div>)}
            </CardContent>
            )}
          </Card>

          <fieldset disabled={formLocked} className="disabled:opacity-60 disabled:pointer-events-none space-y-6">
          <Card>
            <CardHeader><CardTitle className="text-base">Signatories</CardTitle></CardHeader>
            <CardContent>
              <div className="grid gap-x-4 gap-y-3 sm:grid-cols-2">
                <FormField control={form.control} name="inspector_1_id" render={({ field }) => (
                  <FormItem><FormLabel>Signatory 1</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value} disabled={!!editId && existingDoc?.status !== "draft" && currentUser?.id !== existingDoc?.created_by}>
                      <FormControl><SelectTrigger className="w-full"><SelectValue placeholder="Name and Designation">{inspector1Id ? users.find((u) => u.id === inspector1Id)?.full_name : ""}</SelectValue></SelectTrigger></FormControl>
                      <SelectContent>{users.map((u) => (<SelectItem key={u.id} value={u.id}><span className="inline-flex items-baseline gap-2"><span>{u.full_name}:</span><span className="text-muted-foreground">{u.designation?.name || "-"}</span></span></SelectItem>))}</SelectContent>
                    </Select>
                  </FormItem>
                )} />
                <FormField control={form.control} name="inspector_2_id" render={({ field }) => (
                  <FormItem><FormLabel>Signatory 2</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value} disabled={!!editId && existingDoc?.status !== "draft" && currentUser?.id !== existingDoc?.created_by}>
                      <FormControl><SelectTrigger className="w-full"><SelectValue placeholder="Name and Designation">{inspector2Id ? users.find((u) => u.id === inspector2Id)?.full_name : ""}</SelectValue></SelectTrigger></FormControl>
                      <SelectContent>{users.map((u) => (<SelectItem key={u.id} value={u.id}><span className="inline-flex items-baseline gap-2"><span>{u.full_name}:</span><span className="text-muted-foreground">{u.designation?.name || "-"}</span></span></SelectItem>))}</SelectContent>
                    </Select>
                  </FormItem>
                )} />
                <div>
                  <div className={`h-16 rounded-md border-2 border-dashed flex items-center justify-center transition-colors ${signed.inspector1 ? "border-emerald-500/50 bg-emerald-500/5" : currentUser?.id === inspector1Id ? "border-border hover:border-primary/50 cursor-pointer" : "border-border opacity-50 cursor-not-allowed"}`}
                    onClick={() => { if (currentUser?.id === inspector1Id && !signed.inspector1) handleSign("site_engineer"); }}>
                    {signed.inspector1 ? <img src={`${api.defaults.baseURL}/reports/signature-preview?name=${encodeURIComponent((() => { const u = users.find((u) => u.id === inspector1Id); return u?.signature_text || u?.full_name || ""; })())}&font_id=${users.find((u) => u.id === inspector1Id)?.signature_font || "dancing_script"}&color=${sigColor}`} alt="Signature" className="h-10 object-contain" /> : <span className="text-sm text-muted-foreground">{currentUser?.id === inspector1Id ? "Click to sign" : "Awaiting signature"}</span>}
                  </div>
                  <div className="h-5 mt-1">{currentUser?.id === inspector1Id && <Link href="/profile" className="text-xs text-primary hover:underline inline-flex items-center gap-1"><PenLine className="h-3 w-3" />Change signature style</Link>}</div>
                </div>
                <div>
                  <div className={`h-16 rounded-md border-2 border-dashed flex items-center justify-center transition-colors ${signed.inspector2 ? "border-emerald-500/50 bg-emerald-500/5" : currentUser?.id === inspector2Id ? "border-border hover:border-primary/50 cursor-pointer" : "border-border opacity-50 cursor-not-allowed"}`}
                    onClick={() => { if (currentUser?.id === inspector2Id && !signed.inspector2) handleSign("qaqc_engineer"); }}>
                    {signed.inspector2 ? <img src={`${api.defaults.baseURL}/reports/signature-preview?name=${encodeURIComponent((() => { const u = users.find((u) => u.id === inspector2Id); return u?.signature_text || u?.full_name || ""; })())}&font_id=${users.find((u) => u.id === inspector2Id)?.signature_font || "dancing_script"}&color=${sigColor}`} alt="Signature" className="h-10 object-contain" /> : <span className="text-sm text-muted-foreground">{currentUser?.id === inspector2Id ? "Click to sign" : "Awaiting signature"}</span>}
                  </div>
                  <div className="h-5 mt-1">{currentUser?.id === inspector2Id && <Link href="/profile" className="text-xs text-primary hover:underline inline-flex items-center gap-1"><PenLine className="h-3 w-3" />Change signature style</Link>}</div>
                </div>
                <fieldset disabled={currentUser?.id !== inspector1Id} className="disabled:opacity-50 disabled:pointer-events-none">
                  <div className="grid grid-cols-2 gap-2">
                    <FormField control={form.control} name="inspector_date_1" render={({ field }) => (<FormItem><FormLabel>Date</FormLabel><FormControl><DatePicker value={field.value} onChange={field.onChange} placeholder="Select date" /></FormControl></FormItem>)} />
                    <FormField control={form.control} name="inspector_time_1" render={({ field }) => (<FormItem><FormLabel>Time</FormLabel><FormControl><TimePicker value={field.value} onChange={field.onChange} placeholder="Select time" /></FormControl></FormItem>)} />
                  </div>
                </fieldset>
                <fieldset disabled={currentUser?.id !== inspector2Id} className="disabled:opacity-50 disabled:pointer-events-none">
                  <div className="grid grid-cols-2 gap-2">
                    <FormField control={form.control} name="inspector_date_2" render={({ field }) => (<FormItem><FormLabel>Date</FormLabel><FormControl><DatePicker value={field.value} onChange={field.onChange} placeholder="Select date" /></FormControl></FormItem>)} />
                    <FormField control={form.control} name="inspector_time_2" render={({ field }) => (<FormItem><FormLabel>Time</FormLabel><FormControl><TimePicker value={field.value} onChange={field.onChange} placeholder="Select time" /></FormControl></FormItem>)} />
                  </div>
                </fieldset>
                <fieldset disabled={currentUser?.id !== inspector1Id} className="disabled:opacity-50 disabled:pointer-events-none">
                  <FormField control={form.control} name="remarks_1" render={({ field }) => (<FormItem><FormLabel>Remarks</FormLabel><FormControl><Textarea placeholder="Remarks..." className="resize-none" rows={2} {...field} /></FormControl></FormItem>)} />
                </fieldset>
                <fieldset disabled={currentUser?.id !== inspector2Id} className="disabled:opacity-50 disabled:pointer-events-none">
                  <FormField control={form.control} name="remarks_2" render={({ field }) => (<FormItem><FormLabel>Remarks</FormLabel><FormControl><Textarea placeholder="Remarks..." className="resize-none" rows={2} {...field} /></FormControl></FormItem>)} />
                </fieldset>
              </div>
            </CardContent>
          </Card>

          <Card><CardHeader><CardTitle className="text-base">Attachments</CardTitle></CardHeader>
            <CardContent><DocumentAttachments documentId={editId || undefined} attachments={attachments} onAttachmentsChange={setAttachments} onDirtyChange={() => setIsDirty(true)} showPagePosition={false} showDownloadBundle={false} /></CardContent>
          </Card>

          <div className="flex justify-end gap-3">
            {!formLocked && (<>
              <Button type="button" variant="outline" onClick={handleBack}>Cancel</Button>
              <Button type="submit" variant="secondary" disabled={mutation.isPending || notifyMutation.isPending || (!isDirty && !form.formState.isDirty)}>{mutation.isPending ? "Saving..." : "Save as Draft"}</Button>
              <Button type="button" disabled={!editId || notifyMutation.isPending || (signed.inspector1 && signed.inspector2) || (!inspector1Id || !inspector2Id)} onClick={() => notifyMutation.mutate()}>
                <Send className="h-4 w-4 mr-2" />{notifyMutation.isPending ? "Sending..." : "Notify Signatories"}
              </Button>
            </>)}
          </div>
          </fieldset>
        </form>
      </Form>

      {editId && (
      <div className="flex justify-end gap-3">
        <Button type="button" variant="outline" disabled={pdfLoading} onClick={async () => {
          setPdfLoading(true);
          try { const payload: any = { document_id: editId, project_id: project!.id }; if (selectedTemplateId) payload.template_id = selectedTemplateId; const res = await api.post(`/reports/generate/CIR`, payload, { responseType: "blob" }); const url = URL.createObjectURL(res.data); window.open(url, "_blank"); setTimeout(() => URL.revokeObjectURL(url), 60000); } catch (e: any) { let msg = "PDF generation failed"; try { const text = await e?.response?.data?.text?.(); const parsed = JSON.parse(text); msg = parsed.detail || msg; } catch {} toast.error(msg); } finally { setPdfLoading(false); }
        }}>{pdfLoading ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Generating PDF...</> : "Preview PDF"}</Button>
        <Button type="button" variant="outline" disabled={!signed.inspector1 || !signed.inspector2} onClick={async () => {
          try { const res = await api.get(`/documents/${editId}/bundle`, { responseType: "blob" }); const url = URL.createObjectURL(res.data); const a = document.createElement("a"); a.href = url; a.download = `${referenceNo || "document"}${revisionNo > 0 ? `-REV-${revisionNo}` : ""}.pdf`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 60000); } catch { toast.error("Failed to download document"); }
        }}><Download className="h-4 w-4 mr-2" />Download Document</Button>
      </div>
      )}

      {editId && existingDoc && existingDoc.status !== "draft" && (
        <Card><CardContent className="pt-6"><ApprovalActionPanel documentId={editId} documentType="CIR" documentStatus={existingDoc.status} projectId={project?.id} /></CardContent></Card>
      )}

      <Dialog open={confirmDisableLinkage} onOpenChange={setConfirmDisableLinkage}>
        <DialogContent><DialogHeader><DialogTitle>Disable Commissioning Linkage?</DialogTitle><DialogDescription>You have {selectedAssets.length} asset{selectedAssets.length > 1 ? "s" : ""} selected. Disabling the linkage will deselect all assets.</DialogDescription></DialogHeader>
          <DialogFooter><Button variant="outline" onClick={() => setConfirmDisableLinkage(false)}>Cancel</Button><Button variant="destructive" onClick={() => { setSelectedAssets([]); setCommissioningLinkage(null); setConfirmDisableLinkage(false); }}>Disable & Clear Assets</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
