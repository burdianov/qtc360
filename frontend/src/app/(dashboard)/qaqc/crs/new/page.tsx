"use client";

import { useState, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { z } from "zod/v4";
import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowLeft, Copy, Plus, Trash2, Eye, Download } from "lucide-react";
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
import { omitDocumentCreateOnlyFields } from "@/lib/document-payload";

interface Discipline {
  id: string;
  name: string;
  code: string;
}
interface SourceDoc {
  id: string;
  reference_no: string;
  title: string;
  revision_no: number;
  description: string | null;
}
interface ApprovalRound {
  id: string;
  approver_order: number;
  comments: string | null;
  decision_status_id: string | null;
}
interface ApprovalStatus {
  id: string;
  letter: string;
  name: string;
}
interface CrsRow {
  sn: number;
  comment: string;
  response: string;
}

const schema = z.object({
  subject: z.string().min(1, "Subject is required"),
  discipline_id: z.string().min(1, "Discipline is required"),
});

type FormValues = z.infer<typeof schema>;

export default function NewCRSPage() {
  return (
    <Suspense
      fallback={
        <div className="p-8 text-center text-muted-foreground">Loading...</div>
      }
    >
      <NewCRSPageInner />
    </Suspense>
  );
}

function NewCRSPageInner() {
  const searchParams = useSearchParams();
  const editId = searchParams.get("id");
  return <NewCRSPageContent key={editId || "new"} />;
}

function NewCRSPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const editId = searchParams.get("id");
  const project = useSelectedProject();
  const queryClient = useQueryClient();

  const [sourceDocType, setSourceDocType] = useState<string>("");
  const [selectedSourceDocId, setSelectedSourceDocId] = useState<string>("");
  const [selectedApproverOrder, setSelectedApproverOrder] = useState<
    number | null
  >(null);
  const [rows, setRows] = useState<CrsRow[]>([
    { sn: 1, comment: "", response: "" },
  ]);
  const [refNumber, setRefNumber] = useState("");

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { subject: "", discipline_id: "" },
  });

  const disciplineId = form.watch("discipline_id");

  const { data: disciplines = [] } = useQuery<Discipline[]>({
    queryKey: ["disciplines", project?.id],
    queryFn: async () =>
      (await api.get("/disciplines", { params: { project_id: project?.id } }))
        .data,
    enabled: !!project?.id,
  });

  // Generate ref number when discipline changes
  useEffect(() => {
    if (!project?.id || !disciplineId) return;
    const disc = disciplines.find((d) => d.id === disciplineId);
    if (!disc) return;
    api
      .get("/documents/generate-ref-number", {
        params: {
          project_id: project.id,
          doc_type: "CRS",
          discipline_code: disc.code,
        },
      })
      .then((res) => setRefNumber(res.data?.reference_number || ""))
      .catch(() => {});
  }, [project?.id, disciplineId, disciplines]);

  // Fetch source documents (filter to latest revision only)
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

  // Keep only the latest revision per reference_no
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

  // Fetch approval rounds for selected source doc
  const { data: approvalRounds = [] } = useQuery<ApprovalRound[]>({
    queryKey: ["approval-rounds", selectedSourceDocId],
    queryFn: async () =>
      (await api.get(`/documents/${selectedSourceDocId}/approval-rounds`)).data,
    enabled: !!selectedSourceDocId,
  });

  // Fetch approval statuses for the project
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

  // Load existing document for edit
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

  // Get status from selected approver
  const selectedRound = approvalRounds.find(
    (r) => r.approver_order === selectedApproverOrder,
  );
  const selectedStatus = getStatusLetter(
    selectedRound?.decision_status_id || null,
  );

  const mutation = useMutation({
    mutationFn: async (values: FormValues) => {
      const payload = {
        project_id: project!.id,
        document_type: "CRS",
        reference_no: refNumber,
        title: values.subject,
        status: "approved",
        discipline_id: values.discipline_id,
        crs_data: {
          source_document_id: selectedSourceDocId || null,
          source_doc_type: sourceDocType || null,
          source_approver_order: selectedApproverOrder,
          approver_status: selectedStatus,
          rows: rows.map((r) => ({ ...r, status: selectedStatus })),
        },
      };
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
      window.open(url, "_blank");
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
      a.download = `${refNumber || "CRS"}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      toast.error("Failed to download PDF");
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => router.push("/qaqc/crs")}
        >
          <ArrowLeft className="h-4 w-4 mr-1" />
          Back
        </Button>
        <h1 className="text-2xl font-semibold tracking-tight">
          {editId ? "Edit" : "New"} CRS
        </h1>
      </div>

      <Form {...form}>
        <form
          onSubmit={form.handleSubmit((v) => mutation.mutate(v))}
          noValidate
          className="space-y-6"
        >
          {/* Basic Info */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Basic Information</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-3">
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
                            {disciplines.find((d) => d.id === field.value)
                              ?.name || ""}
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
              <FormItem>
                <FormLabel>Reference Number</FormLabel>
                <Input value={refNumber} readOnly className="bg-muted" />
              </FormItem>
              <FormItem>
                <FormLabel>Revision</FormLabel>
                <Input
                  value={existingDoc?.revision_no ?? 0}
                  readOnly
                  className="bg-muted"
                />
              </FormItem>
            </CardContent>
          </Card>

          {/* Source Document */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Source Document</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="text-sm font-medium mb-1.5 block">
                    Document Type
                  </label>
                  <Select
                    value={sourceDocType}
                    onValueChange={(v) => {
                      setSourceDocType(v);
                      setSelectedSourceDocId("");
                      setSelectedApproverOrder(null);
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select type" />
                    </SelectTrigger>
                    <SelectContent>
                      {["WIR", "MIR", "CIR"].map((t) => (
                        <SelectItem key={t} value={t}>
                          {t}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="text-sm font-medium mb-1.5 block">
                    Document
                  </label>
                  <Select
                    value={selectedSourceDocId}
                    onValueChange={(v) => {
                      setSelectedSourceDocId(v);
                      setSelectedApproverOrder(null);
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select document">
                        {selectedSourceDoc
                          ? `${selectedSourceDoc.reference_no} - ${selectedSourceDoc.title}`
                          : ""}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {sourceDocs.map((d) => (
                        <SelectItem key={d.id} value={d.id}>
                          {d.reference_no} - {d.title}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {selectedSourceDoc && (
                <div className="rounded-md border p-4 space-y-3">
                  {/* Document info - aligned labels and values */}
                  <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
                    <span className="font-medium text-muted-foreground">
                      Ref:
                    </span>
                    <div className="flex items-center gap-2">
                      <span className="select-all">
                        {selectedSourceDoc.reference_no}
                      </span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-5 w-5"
                        onClick={() =>
                          copyToClipboard(selectedSourceDoc.reference_no)
                        }
                      >
                        <Copy className="h-3 w-3" />
                      </Button>
                    </div>
                    <span className="font-medium text-muted-foreground">
                      Rev:
                    </span>
                    <span>{selectedSourceDoc.revision_no}</span>
                    <span className="font-medium text-muted-foreground">
                      Status:
                    </span>
                    <span className="capitalize">
                      {(selectedSourceDoc as any).status?.replace(/_/g, " ") ||
                        ""}
                    </span>
                    <span className="font-medium text-muted-foreground">
                      Subject:
                    </span>
                    <div className="flex items-center gap-2">
                      <span className="select-all">
                        {selectedSourceDoc.title}
                      </span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-5 w-5"
                        onClick={() => copyToClipboard(selectedSourceDoc.title)}
                      >
                        <Copy className="h-3 w-3" />
                      </Button>
                    </div>
                    {selectedSourceDoc.description && (
                      <>
                        <span className="font-medium text-muted-foreground">
                          Description:
                        </span>
                        <div className="flex items-center gap-2">
                          <span className="select-all">
                            {selectedSourceDoc.description}
                          </span>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-5 w-5"
                            onClick={() =>
                              copyToClipboard(selectedSourceDoc.description!)
                            }
                          >
                            <Copy className="h-3 w-3" />
                          </Button>
                        </div>
                      </>
                    )}
                  </div>

                  {/* Approver sections */}
                  {approvalRounds.length > 0 && (
                    <div className="space-y-3 pt-3 border-t">
                      {[1, 2].map((order) => {
                        const round = approvalRounds.find(
                          (r) => r.approver_order === order,
                        );
                        if (!round) return null;
                        const isSelected = selectedApproverOrder === order;
                        return (
                          <div
                            key={order}
                            className={`rounded-md border p-3 cursor-pointer transition-colors ${isSelected ? "border-primary bg-primary/5" : "hover:bg-accent/50"}`}
                            onClick={() => setSelectedApproverOrder(order)}
                          >
                            <div className="flex items-center gap-3">
                              <input
                                type="radio"
                                name="approver_selection"
                                checked={isSelected}
                                onChange={() => setSelectedApproverOrder(order)}
                                className="h-4 w-4"
                              />
                              <span className="text-sm font-medium">
                                Approver {order}
                              </span>
                              {round.decision_status_id && (
                                <Badge variant="outline">
                                  {getStatusLabel(round.decision_status_id)}
                                </Badge>
                              )}
                            </div>
                            {round.comments && (
                              <div className="mt-2 ml-7 flex items-start gap-2">
                                <p className="text-sm text-muted-foreground select-all flex-1">
                                  {round.comments}
                                </p>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon"
                                  className="h-5 w-5 shrink-0"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    copyToClipboard(round.comments!);
                                  }}
                                >
                                  <Copy className="h-3 w-3" />
                                </Button>
                              </div>
                            )}
                            {!round.comments && (
                              <p className="mt-2 ml-7 text-sm text-muted-foreground italic">
                                No comments
                              </p>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          {/* CRS Content */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">CRS Content</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <FormField
                control={form.control}
                name="subject"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Subject *</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder="Enter subject" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="rounded-md border overflow-hidden">
                <table className="w-full text-sm table-fixed">
                  <thead>
                    <tr className="border-b bg-muted/50">
                      <th className="p-2 w-12 text-left font-medium">SN</th>
                      <th className="p-2 text-left font-medium">
                        CXM&apos;s Comments
                      </th>
                      <th className="p-2 text-left font-medium">
                        Responses to CXM&apos;s Comments
                      </th>
                      <th className="p-2 w-10"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row, idx) => (
                      <tr key={idx} className="border-b last:border-b-0">
                        <td className="p-2 text-center align-top text-muted-foreground">
                          {row.sn}
                        </td>
                        <td className="p-2">
                          <Textarea
                            rows={2}
                            value={row.comment}
                            onChange={(e) =>
                              updateRow(idx, "comment", e.target.value)
                            }
                            placeholder="Enter comment"
                            className="resize-none min-h-[60px]"
                          />
                        </td>
                        <td className="p-2">
                          <Textarea
                            rows={2}
                            value={row.response}
                            onChange={(e) =>
                              updateRow(idx, "response", e.target.value)
                            }
                            placeholder="Enter response"
                            className="resize-none min-h-[60px]"
                          />
                        </td>
                        <td className="p-2 align-top">
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-destructive"
                            onClick={() => removeRow(idx)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={addRow}
              >
                <Plus className="h-3.5 w-3.5 mr-1" />
                Add Row
              </Button>
            </CardContent>
          </Card>

          {/* Actions */}
          <div className="flex justify-end gap-3">
            <Button type="button" variant="outline" onClick={handlePreview}>
              <Eye className="h-4 w-4 mr-1" />
              Preview PDF
            </Button>
            <Button type="button" variant="outline" onClick={handleDownload}>
              <Download className="h-4 w-4 mr-1" />
              Download PDF
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
