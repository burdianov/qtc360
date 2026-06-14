"use client";

import { useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import api from "@/lib/api";
import { useSelectedProject } from "@/hooks/use-project";
import { toast } from "sonner";
import { omitDocumentCreateOnlyFields } from "@/lib/document-payload";
import {
  crsSchema,
  crsDefaultValues,
  buildCrsPayload,
  type CrsFormValues,
  type Discipline,
  type SourceDoc,
  type ApprovalRound,
  type ApprovalStatus,
  type CrsRow,
} from "./crs-form";

export function useCrsForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const editId = searchParams.get("id");
  const project = useSelectedProject();
  const queryClient = useQueryClient();

  const [sourceDocType, setSourceDocType] = useState<string>("");
  const [pdfPreviewUrl, setPdfPreviewUrl] = useState<string | null>(null);
  const [selectedSourceDocId, setSelectedSourceDocId] = useState<string>("");
  const [selectedApproverOrder, setSelectedApproverOrder] = useState<
    number | null
  >(null);
  const [rows, setRows] = useState<CrsRow[]>([
    { sn: 1, comment: "", response: "" },
  ]);
  const [refNumber, setRefNumber] = useState("");

  const form = useForm<CrsFormValues>({
    resolver: zodResolver(crsSchema),
    defaultValues: crsDefaultValues,
  });

  const disciplineId = form.watch("discipline_id");

  // ── Reference data ────────────────────────────────────────────────────

  const { data: disciplines = [] } = useQuery<Discipline[]>({
    queryKey: ["disciplines", project?.id],
    queryFn: async () =>
      (await api.get("/disciplines", { params: { project_id: project?.id } }))
        .data,
    enabled: !!project?.id,
  });

  useEffect(() => {
    if (!project?.id || !disciplineId) return;
    const disc = disciplines.find((d) => d.id === disciplineId);
    if (!disc) return;
    setRefNumber("");
  }, [project?.id, disciplineId, disciplines]);

  // ── Source documents ──────────────────────────────────────────────────

  const { data: rawSourceDocs = [] } = useQuery<SourceDoc[]>({
    queryKey: ["source-docs", project?.id, sourceDocType, disciplineId],
    queryFn: async () =>
      (
        await api.get("/documents", {
          params: {
            project_id: project!.id,
            document_type: sourceDocType,
            discipline_id: disciplineId,
            has_comments: true,
          },
        })
      ).data,
    enabled: !!project?.id && !!sourceDocType && !!disciplineId,
  });

  const sourceDocs = (() => {
    const map = new Map<string, SourceDoc>();
    for (const d of rawSourceDocs) {
      const existing = map.get(d.reference_no);
      if (!existing || d.revision_no > existing.revision_no)
        map.set(d.reference_no, d);
    }
    return Array.from(map.values());
  })();

  const selectedSourceDoc =
    sourceDocs.find((d) => d.id === selectedSourceDocId) || null;

  // ── Approval rounds ───────────────────────────────────────────────────

  const { data: approvalRounds = [] } = useQuery<ApprovalRound[]>({
    queryKey: ["approval-rounds", selectedSourceDocId],
    queryFn: async () =>
      (await api.get(`/documents/${selectedSourceDocId}/approval-rounds`)).data,
    enabled: !!selectedSourceDocId,
  });

  const { data: approvalStatuses = [] } = useQuery<ApprovalStatus[]>({
    queryKey: ["approval-statuses", project?.id],
    queryFn: async () =>
      (
        await api.get("/approval-statuses", {
          params: { project_id: project!.id },
        })
      ).data,
    enabled: !!project?.id,
  });

  const getStatusLabel = (statusId: string | null) => {
    if (!statusId) return "";
    const s = approvalStatuses.find((a) => a.id === statusId);
    return s ? `${s.letter} - ${s.name}` : "";
  };

  const getStatusLetter = (statusId: string | null) => {
    if (!statusId) return "";
    const s = approvalStatuses.find((a) => a.id === statusId);
    return s?.letter || "";
  };

  // ── Existing document ─────────────────────────────────────────────────

  const { data: existingDoc } = useQuery({
    queryKey: ["document", editId],
    queryFn: async () => (await api.get(`/documents/${editId}`)).data,
    enabled: !!editId,
  });

  useEffect(() => {
    if (!existingDoc) return;
    form.reset({
      subject: existingDoc.title || "",
      discipline_id: existingDoc.discipline_id || "",
    });
    setRefNumber(existingDoc.reference_no || "");
    if (existingDoc.crs_data) {
      const crs =
        typeof existingDoc.crs_data === "string"
          ? JSON.parse(existingDoc.crs_data)
          : existingDoc.crs_data;
      if (crs.rows?.length) setRows(crs.rows);
      if (crs.source_doc_type) setSourceDocType(crs.source_doc_type);
      if (crs.source_document_id)
        setSelectedSourceDocId(crs.source_document_id);
      if (crs.source_approver_order)
        setSelectedApproverOrder(crs.source_approver_order);
    }
  }, [existingDoc]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Helpers ───────────────────────────────────────────────────────────

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast.success("Copied");
  };

  const addRow = () => {
    setRows([...rows, { sn: rows.length + 1, comment: "", response: "" }]);
  };

  const removeRow = (idx: number) => {
    setRows(
      rows.filter((_, i) => i !== idx).map((r, i) => ({ ...r, sn: i + 1 })),
    );
  };

  const updateRow = (
    idx: number,
    field: "comment" | "response",
    value: string,
  ) => {
    const updated = [...rows];
    updated[idx] = { ...updated[idx], [field]: value };
    setRows(updated);
  };

  const selectedRound = approvalRounds.find(
    (r) => r.approver_order === selectedApproverOrder,
  );
  const selectedStatus = getStatusLetter(
    selectedRound?.decision_status_id || null,
  );

  // ── Mutation ──────────────────────────────────────────────────────────

  const mutation = useMutation({
    mutationFn: async (values: CrsFormValues) => {
      const payload = buildCrsPayload(values, project!.id, {
        sourceDocumentId: selectedSourceDocId,
        sourceDocType,
        sourceApproverOrder: selectedApproverOrder,
        approverStatus: selectedStatus,
        rows,
      });
      if (editId) {
        return api.patch(
          `/documents/${editId}`,
          omitDocumentCreateOnlyFields(payload),
        );
      }
      return api.post("/documents", payload);
    },
    onSuccess: (res) => {
      toast.success(editId ? "CRS updated" : "CRS saved");
      if (res?.data?.reference_no) setRefNumber(res.data.reference_no);
      queryClient.invalidateQueries({ queryKey: ["documents", "CRS"] });
      if (!editId && res?.data?.id)
        router.replace(`/qaqc/crs/new?id=${res.data.id}`);
    },
    onError: (err: unknown) => {
      const raw = (err as { response?: { data?: { detail?: any } } })?.response
        ?.data?.detail;
      const detail =
        typeof raw === "string"
          ? raw
          : Array.isArray(raw)
            ? raw.map((e: any) => e.msg || e).join(", ")
            : "Failed to save CRS";
      toast.error(detail);
    },
  });

  const handlePreview = async () => {
    const docId = editId || existingDoc?.id;
    if (!docId) {
      toast.error("Save the document first");
      return;
    }
    try {
      const res = await api.post(
        "/reports/generate-crs",
        { document_id: docId, project_id: project!.id },
        { responseType: "blob" },
      );
      const url = URL.createObjectURL(res.data);
      setPdfPreviewUrl(url);
    } catch {
      toast.error("Failed to generate PDF");
    }
  };

  const handleDownload = async () => {
    const docId = editId || existingDoc?.id;
    if (!docId) {
      toast.error("Save the document first");
      return;
    }
    try {
      const res = await api.post(
        "/reports/generate-crs",
        { document_id: docId, project_id: project!.id },
        { responseType: "blob" },
      );
      const url = URL.createObjectURL(res.data);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${existingDoc?.reference_no || "CRS"}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      toast.error("Failed to download PDF");
    }
  };

  return {
    form,
    mutation,
    editId,
    project,
    disciplines,
    refNumber,
    sourceDocType,
    setSourceDocType,
    sourceDocs,
    selectedSourceDocId,
    setSelectedSourceDocId,
    selectedSourceDoc,
    selectedApproverOrder,
    setSelectedApproverOrder,
    approvalRounds,
    approvalStatuses,
    getStatusLabel,
    getStatusLetter,
    rows,
    addRow,
    removeRow,
    updateRow,
    copyToClipboard,
    selectedRound,
    selectedStatus,
    existingDoc,
    pdfPreviewUrl,
    setPdfPreviewUrl,
    handlePreview,
    handleDownload,
  };
}
