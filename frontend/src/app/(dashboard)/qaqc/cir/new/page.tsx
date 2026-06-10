"use client";

import { useState, useEffect, useRef, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTheme } from "next-themes";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  ArrowLeft,
  Loader2,
  X,
  Send,
  Download,
} from "lucide-react";
import api from "@/lib/api";
import { useSelectedProject } from "@/hooks/use-project";
import { useCurrentUser } from "@/hooks/use-auth";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DatePicker } from "@/components/ui/date-picker";
import { TimePicker } from "@/components/ui/time-picker";
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
import {
  RequirementSelector,
  type SelectedRequirement,
  type PendingChecklistData,
} from "@/components/requirement-selector";
import { ApprovalActionPanel } from "@/components/approval/approval-action-panel";
import { PdfPreviewModal } from "@/components/pdf-preview-modal";
import { DocumentAttachments } from "@/components/document-attachments";
import { Spinner } from "@/components/ui/spinner";
import { omitDocumentCreateOnlyFields } from "@/lib/document-payload";
import { CenteredSpinner } from "@/components/loaders/centered-spinner";
import { SignatureImage } from "@/components/SignatureImage";
import {
  cirSchema,
  cirDefaultValues,
  buildCirPayload,
  type CirFormValues,
  type Discipline,
  type InspectorUser,
  type CirAsset,
  type CirAssetType,
  type CirService,
} from "./_lib/cir-form";

export default function NewCIRPage() {
  return (
    <Suspense fallback={<CenteredSpinner label="Loading document…" />}>
      <NewCIRPageInner />
    </Suspense>
  );
}

function NewCIRPageInner() {
  const searchParams = useSearchParams();
  const editId = searchParams.get("id");
  // Preserve component state when transitioning from new → edit after save.
  // Only force a fresh mount when coming directly to an edit page (different doc)
  // or when clearing the id to create a brand-new document.
  const wasNewRef = useRef(!editId);
  const [componentKey, setComponentKey] = useState(() => {
    if (!editId) return "new-" + Math.random().toString(36).slice(2);
    return editId;
  });

  useEffect(() => {
    if (!editId) {
      // Navigating to "new" — always force a fresh mount
      wasNewRef.current = true;
      setComponentKey("new-" + Math.random().toString(36).slice(2));
    } else if (wasNewRef.current) {
      // Transitioning from new → edit (after save) — preserve the key
      wasNewRef.current = false;
    } else {
      // Directly navigating to an edit page — use editId as key
      setComponentKey(editId);
      wasNewRef.current = false;
    }
  }, [editId]);

  return <NewCIRPageContent key={componentKey} />;
}

function NewCIRPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const editId = searchParams.get("id");
  const project = useSelectedProject();
  const { data: currentUser } = useCurrentUser();
  const queryClient = useQueryClient();
  const { resolvedTheme } = useTheme();
  const _sigColor = resolvedTheme === "dark" ? "%23f8fafc" : "%230f172a";
  const [attachments, setAttachments] = useState<
    {
      id?: string;
      file?: File;
      name: string;
      size: number;
      isExisting?: boolean;
      insert_after_page?: number | null;
    }[]
  >([]);
  const [signed, setSigned] = useState<{
    inspector1: boolean;
    inspector2: boolean;
  }>({ inspector1: false, inspector2: false });
  const [sigTouched, setSigTouched] = useState({ inspector1: false, inspector2: false });
  const [commissioningLinkage, setCommissioningLinkage] =
    useState<CommissioningLinkage | null>(null);
  const linkageDirtyRef = useRef(false);
  const restoringLinkageRef = useRef(false);
  const [selectedRequirements, setSelectedRequirements] = useState<
    SelectedRequirement[]
  >([]);
  const [pendingChecklists, setPendingChecklists] = useState<
    Map<string, PendingChecklistData>
  >(new Map());
  const restoringSelectedRef = useRef(false);
  const [referenceNo, setReferenceNo] = useState<string>("");
  const [revisionNo, setRevisionNo] = useState<number>(0);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>("");
  const programmaticDirtyRef = useRef(!editId);
  const [pdfPreviewUrl, setPdfPreviewUrl] = useState<string | null>(null);
  const [submissionMode, setSubmissionMode] = useState<"new" | "revision">(
    "new",
  );
  const [revisionOfId, setRevisionOfId] = useState<string | null>(null);

  const { data: disciplines = [] } = useQuery<Discipline[]>({
    queryKey: ["disciplines"],
    queryFn: async () => (await api.get("/disciplines")).data,
  });
  const { data: users = [] } = useQuery<InspectorUser[]>({
    queryKey: ["users"],
    queryFn: async () => (await api.get("/auth/users")).data,
  });

  const { data: delegatedBy = [] } = useQuery<{ grantor_id: string }[]>({
    queryKey: ["delegated-by"],
    queryFn: async () => (await api.get("/auth/me/delegated-by")).data,
  });
  const delegatedByIds = new Set(delegatedBy.map((d) => d.grantor_id));
  const canSignFor = (assignedId: string | undefined) =>
    assignedId === currentUser?.id || (!!assignedId && delegatedByIds.has(assignedId));

  const { data: assets = [] } = useQuery<CirAsset[]>({
    queryKey: ["assets", project?.id],
    queryFn: async () =>
      (await api.get("/assets", { params: { project_id: project?.id } })).data,
    enabled: !!project?.id,
  });
  const { data: services = [] } = useQuery<CirService[]>({
    queryKey: ["services"],
    queryFn: async () => (await api.get("/services")).data,
  });
  const { data: assetTypes = [] } = useQuery<CirAssetType[]>({
    queryKey: ["asset-types"],
    queryFn: async () => (await api.get("/asset-types")).data,
  });

  const { data: docTemplates = [] } = useQuery<
    { id: string; name: string; version: number; is_active: boolean }[]
  >({
    queryKey: ["doc-templates", project?.id, "CIR"],
    queryFn: async () =>
      (
        await api.get("/reports/templates", {
          params: { project_id: project!.id, doc_type: "CIR" },
        })
      ).data,
    enabled: !!project?.id,
  });

  useEffect(() => {
    if (docTemplates.length === 0) return;

    setSelectedTemplateId((currentTemplateId) => {
      const current = docTemplates.find((t) => t.id === currentTemplateId);
      if (current) return currentTemplateId;

      const active = docTemplates.find((t) => t.is_active);
      return active?.id || docTemplates[0].id;
    });
  }, [docTemplates]);

  const { data: allTemplates = [] } = useQuery<
    {
      id: string;
      name: string;
      code: string;
      level_code: string;
      requirement_category: string;
      evidence_document_type: string;
      is_gate_requirement: boolean;
    }[]
  >({
    queryKey: ["requirement-templates", project?.id, "CIR"],
    queryFn: async () => {
      const res = await api.get("/commissioning/requirement-templates", {
        params: { project_id: project?.id },
      });
      return (res.data as any[]).filter(
        (t) => t.evidence_document_type === "CIR",
      );
    },
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

  const { data: rejectedDocs = {} } = useQuery<
    Record<
      string,
      {
        id: string;
        reference_no: string;
        revision_no: number;
        title: string;
        document_type: string;
        full_reference_no?: string;
        discipline_id: string | null;
      }[]
    >
  >({
    queryKey: ["rejected-for-revision", project?.id, "CIR"],
    queryFn: async () =>
      (
        await api.get("/documents/rejected-for-revision", {
          params: { project_id: project?.id, document_type: "CIR" },
        })
      ).data,
    enabled: !!project?.id && !editId && submissionMode === "revision",
  });

  const form = useForm<CirFormValues>({
    resolver: zodResolver(cirSchema),
    defaultValues: cirDefaultValues,
  });

  const { data: existingDoc } = useQuery({
    queryKey: ["document", editId],
    queryFn: async () => (await api.get(`/documents/${editId}`)).data,
    enabled: !!editId,
  });

  const formLocked =
    !!existingDoc &&
    [
      "with_approver_1",
      "approver_1_returned",
      "with_approver_2",
      "approved",
      "approved_with_comments",
      "rejected",
      "superseded",
    ].includes(existingDoc.status);
  const _fullyLocked =
    !!existingDoc &&
    [
      "with_approver_1",
      "approver_1_returned",
      "with_approver_2",
      "approved",
      "approved_with_comments",
      "rejected",
      "superseded",
    ].includes(existingDoc.status);

  const existingDocLoadedRef = useRef(false);

  useEffect(() => {
    if (existingDoc && !existingDocLoadedRef.current) {
      existingDocLoadedRef.current = true;
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
        remarks_1: existingDoc.remarks_1 || "",
        remarks_2: existingDoc.remarks_2 || "",
        inspector_date_1: existingDoc.inspector_date_1 || "",
        inspector_time_1: existingDoc.inspector_time_1 || "",
        date: existingDoc.inspection_date
          ? existingDoc.inspection_date.split("T")[0]
          : "",
      });
      setSigned({
        inspector1: !!existingDoc.site_engineer_signed,
        inspector2: !!existingDoc.qaqc_engineer_signed,
      });
      setReferenceNo(existingDoc.reference_no || "");
      setRevisionNo(existingDoc.revision_no || 0);
    }
  // Only runs when existingDoc first becomes available (guarded by existingDocLoadedRef).
  // form.reset, setSigned, setReferenceNo, setRevisionNo are stable and don't need to be deps.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [existingDoc]);

  useEffect(() => {
    if (!editId || allAssetRequirements.length === 0 || (commissioningLinkage && selectedRequirements.length > 0))
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
        const checkedByTmplAsset = new Map<string, Set<string>>();
        for (const link of links) {
          const tmpl = arIdToTmpl.get(link.asset_requirement_id);
          const asset = arIdToAsset.get(link.asset_requirement_id);
          if (!tmpl || !asset) continue;
          if (!byTmpl.has(tmpl)) byTmpl.set(tmpl, new Set());
          byTmpl.get(tmpl)!.add(asset);
          if (link.requirement_work_item_id) {
            const key = `${tmpl}|${asset}`;
            if (!checkedByTmplAsset.has(key)) checkedByTmplAsset.set(key, new Set());
            checkedByTmplAsset.get(key)!.add(link.requirement_work_item_id);
          }
        }
        const blocks: import("@/components/commissioning-linkage").CommissioningLinkageBlock[] =
          [];
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
                  (a) => a.asset_id === assetId && a.requirement_template_id === tmplId,
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
        if (blocks.length > 0) {
          restoringLinkageRef.current = true;
          restoringSelectedRef.current = true;
          const reqs: SelectedRequirement[] = blocks.map((b) => ({
            id: Math.random().toString(36).slice(2),
            requirementTemplateId: b.requirementTemplateId,
          }));
          setSelectedRequirements(reqs);
          setCommissioningLinkage(blocks);
          setTimeout(() => {
            restoringLinkageRef.current = false;
            restoringSelectedRef.current = false;
          }, 500);
        }
      })
      .catch((err) => {
        if (err && typeof err === "object" && "code" in err && (err as any).code === "ERR_CANCELED") return;
        console.error("Failed to restore commissioning linkage:", err);
      });
    return () => controller.abort();
  }, [editId, allAssetRequirements, commissioningLinkage, selectedRequirements.length]);

  useEffect(() => {
    if (!editId) return;
    const controller = new AbortController();
    api
      .get(`/documents/${editId}/attachments`, { signal: controller.signal })
      .then((res) => {
        setAttachments(
          res.data.map((a: any) => ({
            id: a.id,
            name: a.filename,
            size: a.size,
            isExisting: true,
          })),
        );
      })
      .catch((err) => {
        if (err && typeof err === "object" && "code" in err && (err as any).code === "ERR_CANCELED") return;
        console.error("Failed to load existing attachments:", err);
      });
    return () => controller.abort();
  }, [editId]);

  // Pre-fill from rejected document for revision
  useEffect(() => {
    if (!revisionOfId || editId) return;
    const controller = new AbortController();
    (async () => {
      try {
        const { data: doc } = await api.get(`/documents/${revisionOfId}`, {
          signal: controller.signal,
        });
        if (controller.signal.aborted) return;
        form.reset({
          subject: doc.title || "",
          discipline_id: doc.discipline_id || "",
          description: doc.description || "",
          general_location: doc.location || "",
          floor_level_room: doc.floor_level || "",
          approved_rams: doc.rams_ref || "",
          drawing_reference: doc.drawing_ref || "",
          inspector_1_id: doc.site_engineer_id || "",
          inspector_2_id: doc.qaqc_engineer_id || "",
          remarks_1: doc.remarks_1 || "",
          remarks_2: doc.remarks_2 || "",
          inspector_date_1: doc.inspector_date_1 || "",
          inspector_time_1: doc.inspector_time_1 || "",
          date: new Date().toISOString().split("T")[0],
        });
        setReferenceNo(doc.reference_no || "");
        setRevisionNo(doc.revision_no + 1);
        const linksRes = await api.get("/commissioning/document-links", {
          params: { document_id: revisionOfId },
          signal: controller.signal,
        });
        if (controller.signal.aborted) return;
        const links = linksRes.data as {
          asset_requirement_id: string;
          requirement_work_item_id: string | null;
        }[];
        if (links.length > 0) {
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
          if (blocks.length > 0) {
            restoringSelectedRef.current = true;
            const reqs: SelectedRequirement[] = blocks.map((b) => ({
              id: Math.random().toString(36).slice(2),
              requirementTemplateId: b.requirementTemplateId,
            }));
            setSelectedRequirements(reqs);
            setCommissioningLinkage(blocks);
            linkageDirtyRef.current = true;
            setTimeout(() => { restoringSelectedRef.current = false; }, 500);
          }
        }
        programmaticDirtyRef.current = true;
      } catch (err: any) {
        if (err && typeof err === "object" && "code" in err && err.code === "ERR_CANCELED") return;
        toast.error("Failed to load rejected document data");
        console.error("Failed to load rejected document data:", err);
      }
    })();
    return () => controller.abort();
  }, [revisionOfId, editId, assets, allAssetRequirements, form]);

  const disciplineId = form.watch("discipline_id");
  const applicableTemplateIds = (() => {
    if (!disciplineId) return null;
    const disciplineTypeIds = new Set(
      assetTypes
        .filter((t) => {
          const svc = services.find((s) => s.id === t.service_id);
          return svc?.discipline_id === disciplineId;
        })
        .map((t) => t.id),
    );
    const disciplineAssetIds = new Set(
      assets
        .filter((a) => disciplineTypeIds.has(a.asset_type_id))
        .map((a) => a.id),
    );
    return new Set(
      allAssetRequirements
        .filter((ar) => disciplineAssetIds.has(ar.asset_id))
        .map((ar) => ar.requirement_template_id),
    );
  })();
  // applicableAssetIds removed — each block manages its own asset selection

  // ── Warn when discipline changes and incompatible requirements exist ──────────
  const prevDisciplineRef = useRef<string | null>(null);
  const revertingDisciplineRef = useRef(false);
  const applicableTemplateIdsRef = useRef(applicableTemplateIds);
  applicableTemplateIdsRef.current = applicableTemplateIds;

  useEffect(() => {
    const prev = prevDisciplineRef.current;
    prevDisciplineRef.current = disciplineId ?? null;

    // Skip when reverting a declined discipline change
    if (revertingDisciplineRef.current) {
      revertingDisciplineRef.current = false;
      return;
    }
    // Skip initial mount, no-op change, or initial selection from nothing
    if (prev === (disciplineId ?? null)) return;
    if (!prev) return;
    // Skip if no requirements to lose
    if (selectedRequirements.length === 0) return;

    const currentSet = applicableTemplateIdsRef.current;
    const incompatible = selectedRequirements.filter(
      (req) => !currentSet || !currentSet.has(req.requirementTemplateId),
    );

    if (incompatible.length === 0) return;

    const confirmed = window.confirm(
      `${incompatible.length} requirement(s) don't belong to the newly selected discipline. They will be removed along with any filled checklists. Continue?`,
    );

    if (confirmed) {
      const incompatibleIds = new Set(incompatible.map((r) => r.id));
      setSelectedRequirements((prev) =>
        prev.filter((r) => !incompatibleIds.has(r.id)),
      );
      // Clear pending checklists for removed requirements
      const next = new Map(pendingChecklists);
      for (const req of incompatible) {
        next.delete(req.requirementTemplateId);
      }
      setPendingChecklists(next);
      programmaticDirtyRef.current = true;
      // commissioningLinkage synced by the sync-effect below
    } else {
      // Revert discipline back to the previous value
      revertingDisciplineRef.current = true;
      form.setValue("discipline_id", prev);
    }
  }, [disciplineId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Sync selectedRequirements with commissioningLinkage blocks
  useEffect(() => {
    if (restoringSelectedRef.current || restoringLinkageRef.current) return;

    const currentBlocks = commissioningLinkage ?? [];
    const selectedTmplIds = new Set(
      selectedRequirements.map((r) => r.requirementTemplateId),
    );

    let updated = currentBlocks.filter((b) =>
      selectedTmplIds.has(b.requirementTemplateId),
    );

    const existingTmplIds = new Set(updated.map((b) => b.requirementTemplateId));
    for (const req of selectedRequirements) {
      if (!existingTmplIds.has(req.requirementTemplateId)) {
        updated = [
          ...updated,
          {
            id: Math.random().toString(36).slice(2),
            requirementTemplateId: req.requirementTemplateId,
            assetIds: [],
            isPartialScope: false,
            assetStates: {},
          },
        ];
      }
    }

    const changed =
      updated.length !== currentBlocks.length ||
      updated.some((b, i) => b.requirementTemplateId !== currentBlocks[i]?.requirementTemplateId);

    if (changed) {
      setCommissioningLinkage(updated.length > 0 ? updated : null);
      linkageDirtyRef.current = true;
      programmaticDirtyRef.current = true;
    }
    // selectedRequirements.length is covered by selectedRequirements identity change
  }, [selectedRequirements, commissioningLinkage]);

  useEffect(() => {
    // Reference number is allocated server-side at the moment of save.
    // We no longer pre-fetch it (it could go stale). It will be populated
    // from the POST response in onSuccess.
    if (
      !editId &&
      !revisionOfId &&
      disciplineId &&
      project?.id &&
      disciplines.length > 0
    ) {
      setReferenceNo(""); // ensure no stale value
    }
  }, [editId, revisionOfId, disciplineId, project?.id, disciplines]);

  const inspector1Id = form.watch("inspector_1_id");
  const inspector2Id = form.watch("inspector_2_id");

  const handleSign = async (role: "site_engineer" | "qaqc_engineer") => {
    if (!editId) {
      toast.error("Please save the document first before signing");
      return;
    }
    if (programmaticDirtyRef.current || form.formState.isDirty) {
      toast.error("Please save your changes before signing");
      return;
    }
    const assignedId = role === "site_engineer" ? inspector1Id : inspector2Id;
    const url = `/documents/${editId}/sign?role=${role}${assignedId ? `&on_behalf_of=${assignedId}` : ""}`;
    try {
      await api.post(url);
      setSigned((s) =>
        role === "site_engineer"
          ? { ...s, inspector1: true }
          : { ...s, inspector2: true },
      );
      queryClient.invalidateQueries({ queryKey: ["document", editId] });
      toast.success("Signed successfully");
    } catch (e: any) {
      toast.error(e.response?.data?.detail || "Failed to sign");
    }
  };

  const handleUnsign = async (role: "site_engineer" | "qaqc_engineer") => {
    if (!editId) return;
    try {
      await api.post(`/documents/${editId}/unsign?role=${role}`);
      setSigned((s) =>
        role === "site_engineer"
          ? { ...s, inspector1: false }
          : { ...s, inspector2: false },
      );
      queryClient.invalidateQueries({ queryKey: ["document", editId] });
      toast.success("Signature removed");
    } catch (e: any) {
      toast.error(e.response?.data?.detail || "Failed to remove signature");
    }
  };

  const buildPayload = (values: CirFormValues) =>
    buildCirPayload(values, project!.id, commissioningLinkage, revisionOfId);

  const saveCommissioningLinkage = async (docId: string | null) => {
    if (!commissioningLinkage || !docId) return;
    // Track created work item IDs so we can clear newItems after persisting.
    const createdIdsByBlockAndAsset = new Map<string, Map<string, string[]>>();
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
              .catch((err: any) => { console.error("Failed to delete work item:", err); });
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
          // Track created IDs so we can move them into checkedExistingIds
          if (created.length > 0) {
            if (!createdIdsByBlockAndAsset.has(block.id)) {
              createdIdsByBlockAndAsset.set(block.id, new Map());
            }
            createdIdsByBlockAndAsset.get(block.id)!.set(assetId, [...created]);
          }
          // Delete all existing document-links for this asset_requirement
          // so we can recreate a clean set (prevents duplicates and handles
          // unchecked items).
          await api
            .delete("/commissioning/document-links", {
              params: { document_id: docId, asset_requirement_id: assetReq.id },
            })
            .catch(() => {});
          for (const wiId of [...(s?.checkedExistingIds ?? []), ...created]) {
            await api
              .post("/commissioning/document-links", {
                document_id: docId,
                asset_requirement_id: assetReq.id,
                requirement_work_item_id: wiId,
              })
              .catch((err: any) => { console.error("Failed to create document-requirement link:", err); });
          }
        } else {
          // Clean up existing links first to prevent duplicates on re-save
          await api
            .delete("/commissioning/document-links", {
              params: { document_id: docId, asset_requirement_id: assetReq.id },
            })
            .catch(() => {});
          await api
            .post("/commissioning/document-links", {
              document_id: docId,
              asset_requirement_id: assetReq.id,
            })
            .catch((err: any) => { console.error("Failed to create document-requirement link:", err); });
        }
      }
      if (block.gateWarningAcknowledged) {
        for (const assetId of block.assetIds) {
          await api
            .post("/commissioning/gate-overrides", {
              asset_id: assetId,
              document_id: docId,
              level_code: block.gateLevelCode || "L2B",
              incomplete_requirements: block.incompleteRequirements || [],
              notes: block.gateOverrideNotes || null,
            })
            .catch((err: any) => {
              console.error("Failed to record gate override:", err);
              toast.error("Failed to record gate override acknowledgement");
            });
        }
      }
    }
    // After persisting, clear newItems and move created IDs into
    // checkedExistingIds so a subsequent save won't re-create duplicates.
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
  };

  const mutation = useMutation({
    mutationFn: async (values: CirFormValues) => {
      let res;
      const payload = buildPayload(values);

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
        await saveCommissioningLinkage(docId);
        linkageDirtyRef.current = false;
      }
      // Flush pending checklists
      if (pendingChecklists.size > 0 && docId) {
        for (const [requirementTemplateId, data] of pendingChecklists.entries()) {
          await api
            .post("/checklists/documents", {
              document_id: docId,
              requirement_template_id: requirementTemplateId,
              comments: data.comments || null,
              responses: data.responses,
            })
            .catch((err: any) => {
              console.error("Failed to flush pending checklist:", err);
            });
        }
        setPendingChecklists(new Map());
      }
      const newAtts = attachments.filter((a) => !a.isExisting && a.file);
      if (newAtts.length > 0 && docId) {
        for (const att of newAtts) {
          const fd = new FormData();
          fd.append("file", att.file!);
          const params =
            att.insert_after_page != null
              ? `?insert_after_page=${att.insert_after_page}`
              : "";
          await api.post(`/documents/${docId}/attachments${params}`, fd);
        }
      }
      const existingIds = attachments
        .filter((a) => a.isExisting && a.id)
        .map((a) => a.id);
      if (existingIds.length > 0 && docId) {
        await api.patch(`/documents/${docId}/attachments/reorder`, existingIds);
      }
      return res;
    },
    onSuccess: (res) => {
      toast.success(editId ? "CIR updated" : "CIR saved as draft");
      programmaticDirtyRef.current = false;
      setRevisionOfId(null);
      // Server returns the assigned reference number; surface it immediately
      // so the user sees the value before the page navigates to the edit URL.
      if (res?.data?.reference_no) setReferenceNo(res.data.reference_no);
      if (res?.data?.revision_no !== undefined)
        setRevisionNo(res.data.revision_no);
      form.reset(form.getValues());
      queryClient.invalidateQueries({ queryKey: ["documents", "CIR"] });
      const docId = res?.data?.id || editId;
      if (docId)
        api
          .get(`/documents/${docId}/attachments`)
          .then((r) => {
            setAttachments(
              r.data.map((a: any) => ({
                id: a.id,
                name: a.filename,
                size: a.size,
                isExisting: true,
              })),
            );
          })
          .catch((err: any) => {
            console.error("Failed to reload attachments after save:", err);
          });
      if (!editId && res?.data?.id)
        router.replace(`/qaqc/cir/new?id=${res.data.id}`);
    },
  });

  const notifyMutation = useMutation({
    mutationFn: async () => {
      await api.post(`/documents/${editId}/notify-signatories`);
    },
    onSuccess: () => {
      toast.success("Signatories notified");
    },
  });

  const handleBack = () => {
    if (form.formState.isDirty) {
      if (confirm("You have unsaved changes. Save as draft before leaving?")) {
        form.handleSubmit((v) => mutation.mutate(v))();
        return;
      }
    }
    router.push("/qaqc/cir");
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="sm" onClick={handleBack}>
          <ArrowLeft className="h-4 w-4 mr-1" />
          Back
        </Button>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {editId ? "Edit" : "New"} Commissioning Inspection Request
          </h1>
          <p className="text-sm text-muted-foreground">
            Fill in the CIR submission form
          </p>
        </div>
      </div>

      <Form {...form}>
        <form
          onSubmit={form.handleSubmit(
            (v) => mutation.mutate(v),
            () => toast.error("Please fill in all required fields"),
          )}
          noValidate
          className="space-y-6"
        >
          {!editId && (
            <Card>
              <CardContent className="pt-6 space-y-4">
                <div className="flex items-center gap-6">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="submission_mode"
                      checked={submissionMode === "new"}
                      onChange={() => {
                        setSubmissionMode("new");
                        setRevisionOfId(null);
                        setRevisionNo(0);
                        setReferenceNo("");
                      }}
                      className="h-4 w-4"
                    />
                    <span className="text-sm font-medium">New Submission</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="submission_mode"
                      checked={submissionMode === "revision"}
                      onChange={() => setSubmissionMode("revision")}
                      className="h-4 w-4"
                    />
                    <span className="text-sm font-medium">Revision</span>
                  </label>
                </div>
                {submissionMode === "revision" && (
                  <div className="space-y-2">
                    <FormLabel>Select Rejected Document</FormLabel>
                    <Select
                      value={revisionOfId || ""}
                      onValueChange={(v: string) => setRevisionOfId(v)}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select a rejected document to revise">
                          {(() => {
                            for (const docs of Object.values(rejectedDocs)) {
                              const d = docs.find((d) => d.id === revisionOfId);
                              if (d)
                                return `${d.full_reference_no || d.reference_no} - ${d.title}`;
                            }
                            return "";
                          })()}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        {Object.entries(rejectedDocs).map(
                          ([discipline, docs]) => (
                            <div key={discipline}>
                              <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground">
                                {discipline}
                              </div>
                              {docs.map((doc) => (
                                <SelectItem key={doc.id} value={doc.id}>
                                  {doc.full_reference_no || doc.reference_no} -{" "}
                                  {doc.title}
                                </SelectItem>
                              ))}
                            </div>
                          ),
                        )}
                        {Object.keys(rejectedDocs).length === 0 && (
                          <div className="px-2 py-3 text-sm text-muted-foreground text-center">
                            No rejected documents available
                          </div>
                        )}
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          <fieldset
            disabled={formLocked}
            className="disabled:opacity-60 disabled:pointer-events-none"
          >
            <Card>
              <CardHeader>
                <CardTitle className="text-base">General Information</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-4 sm:grid-cols-2">
                <div>
                  <FormItem>
                    <FormLabel>Reference Number</FormLabel>
                    <div className="flex gap-2">
                      <Input
                        value={referenceNo}
                        disabled
                        className="font-mono bg-muted flex-1"
                        placeholder="Reference will be assigned on save"
                      />
                      {(revisionNo > 0 || editId) && (
                        <div className="flex items-center px-3 rounded-md border bg-muted text-sm font-mono whitespace-nowrap">
                          Rev {revisionNo}
                        </div>
                      )}
                    </div>
                  </FormItem>
                </div>
                <div>
                  <FormItem>
                    <FormLabel>Template</FormLabel>
                    <Select
                      value={
                        selectedTemplateId ||
                        (docTemplates.length === 1 ? docTemplates[0].id : "")
                      }
                      onValueChange={(v: any) => {
                        setSelectedTemplateId(v);
                        programmaticDirtyRef.current = true;
                      }}
                      disabled={docTemplates.length <= 1}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select template">
                          {(() => {
                            const t = docTemplates.find(
                              (t) =>
                                t.id ===
                                (selectedTemplateId ||
                                  (docTemplates.length === 1
                                    ? docTemplates[0].id
                                    : "")),
                            );
                            return t ? `${t.name} (v${t.version})` : "";
                          })()}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        {docTemplates.map((t) => (
                          <SelectItem key={t.id} value={t.id}>
                            {t.name} (v{t.version}){t.is_active ? " ✓" : ""}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </FormItem>
                </div>
                <FormField
                  control={form.control}
                  name="date"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Date</FormLabel>
                      <FormControl>
                        <DatePicker
                          value={field.value}
                          onChange={field.onChange}
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
                      <Select
                        onValueChange={field.onChange}
                        value={field.value}
                      >
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Select discipline">
                              {disciplineId
                                ? disciplines.find((d) => d.id === disciplineId)
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
                    name="subject"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Subject *</FormLabel>
                        <FormControl>
                          <Input {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
                <div className="sm:col-span-2">
                  <FormField
                    control={form.control}
                    name="description"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Description of Inspection *</FormLabel>
                        <FormControl>
                          <Textarea rows={3} {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
                <FormField
                  control={form.control}
                  name="general_location"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>General Location</FormLabel>
                      <FormControl>
                        <Input {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="floor_level_room"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Floor / Level / Room</FormLabel>
                      <FormControl>
                        <Input {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="approved_rams"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Approved RAMS</FormLabel>
                      <FormControl>
                        <Input {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="drawing_reference"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Drawing Reference</FormLabel>
                      <FormControl>
                        <Input {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </CardContent>
            </Card>
          </fieldset>

          {/* Requirements */}
          <Card>
            <CardContent className="pt-6">
              <RequirementSelector
                projectId={project?.id || ""}
                documentType="CIR"
                documentId={editId || undefined}
                applicableTemplateIds={applicableTemplateIds}
                selectedRequirements={selectedRequirements}
                onRequirementsChange={(reqs) => {
                  setSelectedRequirements(reqs);
                  if (!restoringSelectedRef.current) {
                    programmaticDirtyRef.current = true;
                  }
                }}
                pendingChecklists={pendingChecklists}
                onPendingChecklistsChange={setPendingChecklists}
              />
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
                documentType="CIR"
                templates={allTemplates}
                selectedRequirements={selectedRequirements}
                value={commissioningLinkage}
                onChange={(linkage) => {
                  setCommissioningLinkage(linkage);
                  if (!restoringLinkageRef.current) {
                    linkageDirtyRef.current = true;
                    programmaticDirtyRef.current = true;
                  }
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
                        .catch((err: any) => { console.error("Failed to delete work item:", err); });
                  }
                }}
              />
            </CardContent>
          </Card>

          <fieldset
            disabled={formLocked}
            className="disabled:opacity-60 disabled:pointer-events-none space-y-6"
          >
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Signatories</CardTitle>
              </CardHeader>
              <CardContent className="space-y-5">
                {/* Signatory 1 & 2 side by side */}
                <div className="grid sm:grid-cols-2 gap-6">
                  {/* Signatory 1 */}
                  <div className="space-y-3">
                    <FormField
                      control={form.control}
                      name="inspector_1_id"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Signatory 1</FormLabel>
                          <div className="flex gap-1.5 w-[48%]">
                          <div className="flex-1 min-w-0">
                          <Select
                            onValueChange={(v: string) => { field.onChange(v); setSigTouched((t) => ({ ...t, inspector1: true })); }}
                            value={field.value}
                            disabled={
                              !!editId &&
                              existingDoc?.status !== "draft" &&
                              currentUser?.id !== existingDoc?.created_by
                            }
                          >
                            <FormControl>
                              <SelectTrigger className="w-full">
                                <SelectValue placeholder="Name and Designation">
                                  {inspector1Id
                                    ? users.find((u) => u.id === inspector1Id)?.full_name
                                    : ""}
                                </SelectValue>
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              {users
                                .filter((u) => u.id !== inspector2Id)
                                .map((u) => (
                                  <SelectItem key={u.id} value={u.id}>
                                    <span className="inline-flex items-baseline gap-2">
                                      <span>{u.full_name}:</span>
                                      <span className="text-muted-foreground">
                                        {u.designation?.name || "-"}
                                      </span>
                                    </span>
                                  </SelectItem>
                                ))}
                            </SelectContent>
                          </Select>
                          </div>
                          {field.value && (
                            <button
                              type="button"
                              className="shrink-0 p-2 rounded-md border hover:bg-destructive/10 text-muted-foreground hover:text-destructive"
                              onClick={() => { field.onChange(""); if (signed.inspector1) handleUnsign("site_engineer"); }}
                            >
                              <X className="h-4 w-4" />
                            </button>
                          )}
                          </div>
                          {sigTouched.inspector1 && inspector1Id && inspector1Id !== currentUser?.id && !canSignFor(inspector1Id) && (
                            <p className="text-xs text-amber-600">You don't have signing rights for this user</p>
                          )}
                          {inspector1Id && canSignFor(inspector1Id) && !users.find((u) => u.id === inspector1Id)?.has_signature && (
                            <p className="text-xs text-amber-600">No signature uploaded for this user</p>
                          )}
                        </FormItem>
                      )}
                    />
                    <div
                      className={`h-14 rounded-md border-2 border-dashed flex items-center justify-center transition-colors relative ${
                        signed.inspector1
                          ? "border-emerald-500/50 bg-emerald-500/5"
                          : canSignFor(inspector1Id)
                            ? "border-border hover:border-primary/50 cursor-pointer"
                            : "border-border opacity-50 cursor-not-allowed"
                      }`}
                      onClick={() => {
                        if (canSignFor(inspector1Id) && !signed.inspector1)
                          handleSign("site_engineer");
                      }}
                    >
                      {signed.inspector1 ? (
                        <>
                          <SignatureImage userId={inspector1Id} />
                          {(!existingDoc || existingDoc.status === "draft" || existingDoc.status === "internally_signed") && (
                            <button
                              type="button"
                              className="absolute top-1 right-1 p-0.5 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive"
                              onClick={(e) => { e.stopPropagation(); handleUnsign("site_engineer"); }}
                            >
                              <X className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </>
                      ) : (
                        <span className="text-xs text-muted-foreground">
                          {canSignFor(inspector1Id) ? "Click to sign" : "Awaiting signature"}
                        </span>
                      )}
                    </div>
                    <fieldset
                      disabled={currentUser?.id !== inspector1Id}
                      className="disabled:opacity-50 disabled:pointer-events-none"
                    >
                      <FormField
                        control={form.control}
                        name="remarks_1"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Remarks</FormLabel>
                            <FormControl>
                              <Textarea placeholder="Remarks..." className="resize-none" rows={2} {...field} />
                            </FormControl>
                          </FormItem>
                        )}
                      />
                    </fieldset>
                  </div>

                  {/* Signatory 2 */}
                  <div className="space-y-3">
                    <FormField
                      control={form.control}
                      name="inspector_2_id"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Signatory 2</FormLabel>
                          <div className="flex gap-1.5 w-[48%]">
                          <div className="flex-1 min-w-0">
                          <Select
                            onValueChange={(v: string) => { field.onChange(v); setSigTouched((t) => ({ ...t, inspector2: true })); }}
                            value={field.value}
                            disabled={
                              !!editId &&
                              existingDoc?.status !== "draft" &&
                              currentUser?.id !== existingDoc?.created_by
                            }
                          >
                            <FormControl>
                              <SelectTrigger className="w-full">
                                <SelectValue placeholder="Name and Designation">
                                  {inspector2Id
                                    ? users.find((u) => u.id === inspector2Id)?.full_name
                                    : ""}
                                </SelectValue>
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              {users
                                .filter((u) => u.id !== inspector1Id)
                                .map((u) => (
                                  <SelectItem key={u.id} value={u.id}>
                                    <span className="inline-flex items-baseline gap-2">
                                      <span>{u.full_name}:</span>
                                      <span className="text-muted-foreground">
                                        {u.designation?.name || "-"}
                                      </span>
                                    </span>
                                  </SelectItem>
                                ))}
                            </SelectContent>
                          </Select>
                          </div>
                          {field.value && (
                            <button
                              type="button"
                              className="shrink-0 p-2 rounded-md border hover:bg-destructive/10 text-muted-foreground hover:text-destructive"
                              onClick={() => { field.onChange(""); if (signed.inspector2) handleUnsign("qaqc_engineer"); }}
                            >
                              <X className="h-4 w-4" />
                            </button>
                          )}
                          </div>
                          {sigTouched.inspector2 && inspector2Id && inspector2Id !== currentUser?.id && !canSignFor(inspector2Id) && (
                            <p className="text-xs text-amber-600">You don't have signing rights for this user</p>
                          )}
                          {inspector2Id && canSignFor(inspector2Id) && !users.find((u) => u.id === inspector2Id)?.has_signature && (
                            <p className="text-xs text-amber-600">No signature uploaded for this user</p>
                          )}
                        </FormItem>
                      )}
                    />
                    <div
                      className={`h-14 rounded-md border-2 border-dashed flex items-center justify-center transition-colors relative ${
                        signed.inspector2
                          ? "border-emerald-500/50 bg-emerald-500/5"
                          : canSignFor(inspector2Id)
                            ? "border-border hover:border-primary/50 cursor-pointer"
                            : "border-border opacity-50 cursor-not-allowed"
                      }`}
                      onClick={() => {
                        if (canSignFor(inspector2Id) && !signed.inspector2)
                          handleSign("qaqc_engineer");
                      }}
                    >
                      {signed.inspector2 ? (
                        <>
                          <SignatureImage userId={inspector2Id} />
                          {(!existingDoc || existingDoc.status === "draft" || existingDoc.status === "internally_signed") && (
                            <button
                              type="button"
                              className="absolute top-1 right-1 p-0.5 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive"
                              onClick={(e) => { e.stopPropagation(); handleUnsign("qaqc_engineer"); }}
                            >
                              <X className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </>
                      ) : (
                        <span className="text-xs text-muted-foreground">
                          {canSignFor(inspector2Id) ? "Click to sign" : "Awaiting signature"}
                        </span>
                      )}
                    </div>
                    <fieldset
                      disabled={currentUser?.id !== inspector2Id}
                      className="disabled:opacity-50 disabled:pointer-events-none"
                    >
                      <FormField
                        control={form.control}
                        name="remarks_2"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Remarks</FormLabel>
                            <FormControl>
                              <Textarea placeholder="Remarks..." className="resize-none" rows={2} {...field} />
                            </FormControl>
                          </FormItem>
                        )}
                      />
                    </fieldset>
                  </div>
                </div>

                {/* Date & Time */}
                <div className="flex gap-4 items-end">
                  <FormField
                    control={form.control}
                    name="inspector_date_1"
                    render={({ field }) => (
                      <FormItem className="w-40">
                        <FormLabel>Inspection Date</FormLabel>
                        <FormControl>
                          <DatePicker value={field.value} onChange={field.onChange} placeholder="Select date" />
                        </FormControl>
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="inspector_time_1"
                    render={({ field }) => (
                      <FormItem className="w-32">
                        <FormLabel>Inspection Time</FormLabel>
                        <FormControl>
                          <TimePicker value={field.value} onChange={field.onChange} placeholder="Select time" />
                        </FormControl>
                      </FormItem>
                    )}
                  />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Attachments</CardTitle>
              </CardHeader>
              <CardContent>
                <DocumentAttachments
                  documentId={editId || undefined}
                  attachments={attachments}
                  onAttachmentsChange={setAttachments}
                  onDirtyChange={() => programmaticDirtyRef.current = true}
                  showPagePosition={false}
                  showDownloadBundle={false}
                />
              </CardContent>
            </Card>

            <div className="flex justify-end gap-3">
              {!formLocked && (
                <>
                  <Button type="button" variant="outline" onClick={handleBack}>
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    variant="secondary"
                    disabled={
                      mutation.isPending ||
                      notifyMutation.isPending ||
                      (!programmaticDirtyRef.current && !form.formState.isDirty)
                    }
                  >
                    {mutation.isPending && (
                      <Spinner size="sm" className="mr-1 text-current" />
                    )}
                    {mutation.isPending ? "Saving…" : "Save as Draft"}
                  </Button>
                  <Button
                    type="button"
                    disabled={
                      !editId ||
                      notifyMutation.isPending ||
                      (signed.inspector1 && signed.inspector2) ||
                      !inspector1Id ||
                      !inspector2Id
                    }
                    onClick={() => notifyMutation.mutate()}
                  >
                    <Send className="h-4 w-4 mr-2" />
                    {notifyMutation.isPending
                      ? "Sending..."
                      : "Notify Signatories"}
                  </Button>
                </>
              )}
            </div>
          </fieldset>
        </form>
      </Form>

      {editId && (
        <div className="flex justify-end gap-3">
          <Button
            type="button"
            variant="outline"
            disabled={pdfLoading}
            onClick={async () => {
              setPdfLoading(true);
              try {
                const payload: any = {
                  document_id: editId,
                  project_id: project!.id,
                };
                if (selectedTemplateId)
                  payload.template_id = selectedTemplateId;
                const res = await api.post(`/reports/generate/CIR`, payload, {
                  responseType: "blob",
                });
                const url = URL.createObjectURL(res.data);
                setPdfPreviewUrl(url);
              } catch (e: any) {
                let msg = "PDF generation failed";
                try {
                  const text = await e?.response?.data?.text?.();
                  const parsed = JSON.parse(text);
                  msg = parsed.detail || msg;
                } catch {}
                toast.error(msg);
              } finally {
                setPdfLoading(false);
              }
            }}
          >
            {pdfLoading ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Generating PDF...
              </>
            ) : (
              "Preview PDF"
            )}
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={!signed.inspector1 || !signed.inspector2}
            onClick={async () => {
              try {
                const res = await api.get(`/documents/${editId}/bundle`, {
                  responseType: "blob",
                });
                const url = URL.createObjectURL(res.data);
                const a = document.createElement("a");
                a.href = url;
                a.download = `${existingDoc?.reference_no || "document"}_${String(existingDoc?.revision_no ?? 0).padStart(2, "0")}.pdf`;
                a.click();
                setTimeout(() => URL.revokeObjectURL(url), 60000);
              } catch {
                toast.error("Failed to download document");
              }
            }}
          >
            <Download className="h-4 w-4 mr-2" />
            Download Document
          </Button>
        </div>
      )}

      {editId && existingDoc && existingDoc.status !== "draft" && (
        <Card>
          <CardContent className="pt-6">
            <ApprovalActionPanel
              documentId={editId}
              documentType="CIR"
              documentStatus={existingDoc.status}
              projectId={project?.id}
            />
          </CardContent>
        </Card>
      )}
      <PdfPreviewModal open={!!pdfPreviewUrl} onOpenChange={(o) => { if (!o) { if (pdfPreviewUrl) URL.revokeObjectURL(pdfPreviewUrl); setPdfPreviewUrl(null); } }} pdfUrl={pdfPreviewUrl} title="Document Preview" />
    </div>
  );
}
