"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { type ColumnDef } from "@tanstack/react-table";
import { Plus } from "lucide-react";
import api from "@/lib/api";
import { useSelectedProject } from "@/hooks/use-project";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { DataTable, DataTableColumnHeader, DataTableRowActions, type RowAction } from "@/components/data-table";
import { Badge } from "@/components/ui/badge";
import { statusColors } from "@/lib/constants";

interface Document {
  id: string;
  reference_no: string;
  title: string;
  revision_no: number;
  status: string;
  current_approver_order: number | null;
  delivery_note: string | null;
  created_at: string;
}

export default function MIRPage() {
  const router = useRouter();
  const project = useSelectedProject();
  const queryClient = useQueryClient();

  const { data: documents = [], isLoading } = useQuery<Document[]>({
    queryKey: ["documents", "MIR", project?.id],
    queryFn: async () => (await api.get("/documents", { params: { project_id: project!.id, document_type: "MIR" } })).data,
    enabled: !!project,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/documents/${id}`),
    onSuccess: () => {
      toast.success("Document removed");
      queryClient.invalidateQueries({ queryKey: ["documents", "MIR", project?.id] });
    },
    onError: (err: unknown) => {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      toast.error(detail || "Failed to remove document");
    },
  });

  const isSubmitted = (doc: Document) => {
    const submittedStatuses = ["with_approver_1", "with_approver_2", "approver_1_returned", "approved", "approved_with_comments", "rejected"];
    return submittedStatuses.includes(doc.status);
  };

  const rowActions: RowAction<Document>[] = [
    { label: "Edit", onClick: (row) => router.push(`/qaqc/mir/new?id=${row.id}`) },
    {
      label: (row) => isSubmitted(row) ? "Supersede" : "Delete",
      onClick: (row) => deleteMutation.mutate(row.id),
      destructive: true,
      separator: true,
      confirm: (row) => isSubmitted(row)
        ? "This document was submitted to an approver. It will be marked as superseded and the serial number will not be reused. Continue?"
        : "This document was not submitted. It will be permanently deleted along with all attachments, and its serial number will be available for reuse. Continue?",
    },
  ];

  const columns: ColumnDef<Document, unknown>[] = [
    { accessorKey: "reference_no", header: ({ column }) => <DataTableColumnHeader column={column} title="Number" /> },
    { accessorKey: "title", header: ({ column }) => <DataTableColumnHeader column={column} title="Title" /> },
    { accessorKey: "delivery_note", header: ({ column }) => <DataTableColumnHeader column={column} title="Delivery Note" /> },
    { accessorKey: "revision_no", header: ({ column }) => <DataTableColumnHeader column={column} title="Rev" /> },
    { accessorKey: "status", header: ({ column }) => <DataTableColumnHeader column={column} title="Status" />, cell: ({ row }) => {
      const { status, current_approver_order } = row.original;
      const label = status === "submitted" && current_approver_order ? `Pending Approver ${current_approver_order}` : status.replace(/_/g, " ");
      return <Badge className={statusColors[status] || ""}>{label}</Badge>;
    }},
    { id: "actions", header: "", cell: ({ row }) => <DataTableRowActions row={row.original} actions={rowActions} /> },
  ];

  if (isLoading) return <div className="p-6">Loading...</div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Material Inspection Requests</h1>
          <p className="text-sm text-muted-foreground">Manage MIR submissions</p>
        </div>
        <Button onClick={() => router.push("/qaqc/mir/new")}><Plus className="mr-2 h-4 w-4" />New MIR</Button>
      </div>
      <DataTable columns={columns} data={documents} searchKey="title" searchPlaceholder="Search by title..." onRowClick={(row) => router.push(`/qaqc/mir/new?id=${row.id}`)} />
    </div>
  );
}
