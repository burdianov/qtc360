"use client";

// This hook is structurally identical to use-cir-form.ts — both use the same
// form schema (general_location, floor_level_room, approved_rams, drawing_reference)
// and differ only in the document type string ("WIR" vs "CIR").

import { useState, useEffect, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import api from "@/lib/api";
import { useSelectedProject } from "@/hooks/use-project";
import { useCurrentUser } from "@/hooks/use-auth";
import { toast } from "sonner";
import type { CommissioningLinkage } from "@/components/commissioning-linkage";
import type {
  SelectedRequirement,
  PendingChecklistData,
} from "@/components/requirement-selector";
import { omitDocumentCreateOnlyFields } from "@/lib/document-payload";
import {
  saveCommissioningLinkage,
  buildLinkageBlocksFromLinks,
} from "@/lib/commissioning-linkage-persist";
import {
  wirSchema,
  wirDefaultValues,
  buildWirPayload,
  type WirFormValues,
  type Discipline,
  type InspectorUser,
  type WirAsset,
  type WirAssetType,
  type WirService,
} from "./wir-form";

export function useWirForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const editId = searchParams.get("id");
  const project = useSelectedProject();
  const { data: currentUser } = useCurrentUser();
  const queryClient = useQueryClient();

  // ── State ────────────────────────────────────────────────────────────

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
  const [sigTouched, setSigTouched] = useState(false);
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
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>("");
  const programmaticDirtyRef = useRef(!editId);
  const [pdfPreviewUrl, setPdfPreviewUrl] = useState<string | null>(null);
  const [submissionMode, setSubmissionMode] = useState<"new" | "revision">(
    "new",
  );
  const [revisionOfId, setRevisionOfId] = useState<string | null>(null);

  // ── Reference data queries ────────────────────────────────────────────

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
    assignedId === currentUser?.id ||
    (!!assignedId && delegatedByIds.has(assignedId));

  const { data: assets = [] } = useQuery<WirAsset[]>({
    queryKey: ["assets", project?.id],
    queryFn: async () =>
      (await api.get("/assets", { params: { project_id: project?.id } })).data,
    enabled: !!project?.id,
  });

  const { data: services = [] } = useQuery<WirService[]>({
    queryKey: ["services"],
    queryFn: async () => (await api.get("/services")).data,
  });

  const { data: assetTypes = [] } = useQuery<WirAssetType[]>({
    queryKey: ["asset-types"],
    queryFn: async () => (await api.get("/asset-types")).data,
  });

  const { data: docTemplates = [] } = useQuery<
    { id: string; name: string; version: number; is_active: boolean }[]
  >({
    queryKey: ["doc-templates", project?.id, "WIR"],
    queryFn: async () =>
      (
        await api.get("/reports/templates", {
          params: { project_id: project!.id, doc_type: "WIR" },
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
    queryKey: ["requirement-templates", project?.id, "WIR"],
    queryFn: async () => {
      const res = await api.get("/commissioning/requirement-templates", {
        params: { project_id: project?.id },
      });
      return (res.data as any[]).filter(
        (t) => t.evidence_document_type === "WIR",
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
    queryKey: ["rejected-for-revision", project?.id, "WIR"],
    queryFn: async () =>
      (
        await api.get("/documents/rejected-for-revision", {
          params: { project_id: project?.id, document_type: "WIR" },
        })
      ).data,
    enabled: !!project?.id && !editId && submissionMode === "revision",
  });

  // ── Form ──────────────────────────────────────────────────────────────

  const form = useForm<WirFormValues>({
    resolver: zodResolver(wirSchema),
    defaultValues: wirDefaultValues,
  });

  const disciplineId = form.watch("discipline_id");
  const inspector1Id = form.watch("inspector_1_id");
  const inspector2Id = form.watch("inspector_2_id");

  // ── Existing document ─────────────────────────────────────────────────

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [existingDoc]);

  // ── Restore commissioning linkage + checklists ────────────────────────

  useEffect(() => {
    if (
      !editId ||
      allAssetRequirements.length === 0 ||
      (commissioningLinkage && selectedRequirements.length > 0)
    )
      return;
    const controller = new AbortController();
    (async () => {
      try {
        const linksRes = await api.get("/commissioning/document-links", {
          params: { document_id: editId },
          signal: controller.signal,
        });
        const links = linksRes.data as {
          asset_requirement_id: string;
          requirement_work_item_id: string | null;
        }[];
        const blocks = buildLinkageBlocksFromLinks(links, allAssetRequirements);

        try {
          const checklistsRes = await api.get(
            `/checklists/documents/${editId}`,
            { signal: controller.signal },
          );
          const checklists = checklistsRes.data as {
            requirement_template_id: string;
          }[];
          const blockTmplIds = new Set(
            blocks.map((b) => b.requirementTemplateId),
          );
          for (const cl of checklists) {
            if (!blockTmplIds.has(cl.requirement_template_id)) {
              blocks.push({
                id: Math.random().toString(36).slice(2),
                requirementTemplateId: cl.requirement_template_id,
                assetIds: [],
                isPartialScope: false,
                assetStates: {},
              });
              blockTmplIds.add(cl.requirement_template_id);
            }
          }
        } catch {
          // Non-critical
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
      } catch (err: any) {
        if (
          err &&
          typeof err === "object" &&
          "code" in err &&
          err.code === "ERR_CANCELED"
        )
          return;
        console.error("Failed to restore commissioning linkage:", err);
      }
    })();
    return () => controller.abort();
  }, [editId, allAssetRequirements, commissioningLinkage, selectedRequirements.length]);

  // ── Attachments ───────────────────────────────────────────────────────

  const refetchAttachments = () => {
    const docId = editId;
    if (!docId) return;
    api
      .get(`/documents/${docId}/attachments`)
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
        console.error("Failed to refetch attachments:", err);
      });
  };

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
        if (
          err &&
          typeof err === "object" &&
          "code" in err &&
          (err as any).code === "ERR_CANCELED"
        )
          return;
        console.error("Failed to load existing attachments:", err);
      });
    return () => controller.abort();
  }, [editId]);

  const handlePreviewAttachment = async (
    att: { id?: string; file?: File; name: string; size: number; isExisting?: boolean },
    _index: number,
  ) => {
    try {
      if (att.file) {
        const url = URL.createObjectURL(att.file);
        setPdfPreviewUrl(url);
      } else if (att.isExisting && att.id && editId) {
        const res = await api.get(
          `/documents/${editId}/attachments/${att.id}`,
          { responseType: "blob" },
        );
        const url = URL.createObjectURL(res.data);
        setPdfPreviewUrl(url);
      }
    } catch {
      toast.error("Failed to load attachment preview");
    }
  };

  // ── Revision pre-fill ─────────────────────────────────────────────────

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
          const blocks = buildLinkageBlocksFromLinks(links, allAssetRequirements);
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

  // ── Derived: applicable template IDs ──────────────────────────────────

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

  // ── Discipline change warning ─────────────────────────────────────────

  const prevDisciplineRef = useRef(disciplineId);
  const applicableTemplateIdsRef = useRef(applicableTemplateIds);
  applicableTemplateIdsRef.current = applicableTemplateIds;

  useEffect(() => {
    if (restoringLinkageRef.current || restoringSelectedRef.current) return;
    if (prevDisciplineRef.current && prevDisciplineRef.current !== disciplineId) {
      const prevIds = applicableTemplateIdsRef.current;
      if (
        prevIds &&
        selectedRequirements.some((r) => !prevIds.has(r.requirementTemplateId))
      ) {
        const confirmed = window.confirm(
          "Changing discipline will remove incompatible requirements and checklists. Continue?",
        );
        if (confirmed) {
          setSelectedRequirements([]);
          setPendingChecklists(new Map());
          setCommissioningLinkage(null);
          programmaticDirtyRef.current = true;
        } else {
          form.setValue("discipline_id", prevDisciplineRef.current);
        }
      }
    }
    prevDisciplineRef.current = disciplineId;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [disciplineId]);

  // ── Sync requirements ↔ commissioning linkage ─────────────────────────

  useEffect(() => {
    if (restoringLinkageRef.current || restoringSelectedRef.current) return;
    if (!commissioningLinkage && selectedRequirements.length === 0) return;
    if (commissioningLinkage && commissioningLinkage.length === selectedRequirements.length) {
      const allMatch = commissioningLinkage.every((b) =>
        selectedRequirements.some((r) => r.requirementTemplateId === b.requirementTemplateId),
      );
      if (allMatch) return;
    }
    const blocks = selectedRequirements.map((r) => ({
      id: Math.random().toString(36).slice(2),
      requirementTemplateId: r.requirementTemplateId,
      assetIds: [] as string[],
      isPartialScope: false,
      assetStates: {} as Record<string, any>,
    }));
    setCommissioningLinkage(blocks);
    linkageDirtyRef.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedRequirements]);

  // ── Signing ───────────────────────────────────────────────────────────

  const handleSign = async (role: "site_engineer" | "qaqc_engineer") => {
    if (form.formState.isDirty || programmaticDirtyRef.current) {
      toast.error("Please save the document before signing");
      return;
    }
    if (!editId) return;
    const inspectorId = role === "site_engineer" ? inspector1Id : inspector2Id;
    try {
      const params = new URLSearchParams();
      params.set("role", role);
      if (inspectorId && inspectorId !== currentUser?.id)
        params.set("on_behalf_of", inspectorId);
      await api.post(`/documents/${editId}/sign?${params.toString()}`);
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

  // ── Payload builder ───────────────────────────────────────────────────

  const buildPayload = (values: WirFormValues) =>
    buildWirPayload(values, project!.id, commissioningLinkage, revisionOfId);

  // ── Persist commissioning linkage ─────────────────────────────────────

  const persistLinkage = async (docId: string | null) => {
    await saveCommissioningLinkage(
      commissioningLinkage,
      docId,
      { api, setCommissioningLinkage },
    );
  };

  // ── Save mutation ─────────────────────────────────────────────────────

  const mutation = useMutation({
    mutationFn: async (values: WirFormValues) => {
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
        await persistLinkage(docId);
        linkageDirtyRef.current = false;
      }
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
      toast.success(editId ? "WIR updated" : "WIR saved");
      if (res?.data?.reference_no) {
        setReferenceNo(res.data.reference_no);
      }
      if (res?.data?.revision_no) setRevisionNo(res.data.revision_no);
      queryClient.invalidateQueries({ queryKey: ["documents", "WIR"] });
      programmaticDirtyRef.current = false;
      form.reset(form.getValues());
      refetchAttachments();
      // Checklist PDFs are generated in background tasks — poll
      // with increasing delays so the attachment list catches them.
      [1500, 3000, 5000].forEach((delay) =>
        setTimeout(() => refetchAttachments(), delay),
      );
      if (!editId && res?.data?.id) {
        router.replace(`/qaqc/wir/new?id=${res.data.id}`);
      }
    },
    onError: (err: any) => {
      const msg =
        err?.response?.data?.detail ||
        "Failed to save document. Please try again.";
      if (Array.isArray(msg)) {
        toast.error(msg.map((e: any) => e.msg || e).join(", "));
      } else {
        toast.error(msg);
      }
    },
  });

  // ── Notify mutation ───────────────────────────────────────────────────

  const notifyMutation = useMutation({
    mutationFn: async () => {
      if (
        form.formState.isDirty ||
        programmaticDirtyRef.current ||
        pendingChecklists.size > 0 ||
        attachments.some((a) => !a.isExisting)
      ) {
        if (form.formState.isDirty || programmaticDirtyRef.current) {
          const values = form.getValues();
          await mutation.mutateAsync(values);
        }
      }
      if (!editId) throw new Error("Save document before notifying");
      await api.post(`/documents/${editId}/notify-signatories`);
    },
    onSuccess: () => { toast.success("Signatories notified"); },
    onError: (err: any) => {
      if (err?.message === "Save document before notifying")
        toast.error("Save the document before notifying signatories");
      else
        toast.error(err?.response?.data?.detail || "Failed to notify signatories");
    },
  });

  // ── Navigation ────────────────────────────────────────────────────────

  const handleBack = () => {
    if (
      form.formState.isDirty ||
      programmaticDirtyRef.current ||
      pendingChecklists.size > 0 ||
      attachments.some((a) => !a.isExisting)
    ) {
      const confirmed = window.confirm(
        "You have unsaved changes. Save as draft before leaving?",
      );
      if (confirmed) {
        form.handleSubmit((v) => mutation.mutate(v))();
      }
    }
    router.push("/qaqc/wir");
  };

  return {
    form,
    formLocked,
    programmaticDirtyRef,
    projectId: project?.id,
    disciplines,
    users,
    delegatedByIds,
    canSignFor,
    assets,
    services,
    assetTypes,
    docTemplates,
    allTemplates,
    allAssetRequirements,
    rejectedDocs,
    existingDoc,
    editId,
    attachments,
    setAttachments,
    signed,
    setSigned,
    sigTouched,
    setSigTouched,
    commissioningLinkage,
    setCommissioningLinkage,
    linkageDirtyRef,
    restoringLinkageRef,
    selectedRequirements,
    setSelectedRequirements,
    pendingChecklists,
    setPendingChecklists,
    restoringSelectedRef,
    referenceNo,
    revisionNo,
    selectedTemplateId,
    setSelectedTemplateId,
    pdfPreviewUrl,
    setPdfPreviewUrl,
    submissionMode,
    setSubmissionMode,
    revisionOfId,
    setRevisionOfId,
    currentUser,
    disciplineId,
    inspector1Id,
    inspector2Id,
    applicableTemplateIds,
    mutation,
    notifyMutation,
    handleSign,
    handleUnsign,
    handleBack,
    refetchAttachments,
    handlePreviewAttachment,
    buildPayload,
  };
}
