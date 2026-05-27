"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { type ColumnDef } from "@tanstack/react-table";
import { Plus } from "lucide-react";
import api from "@/lib/api";
import { useSelectedProject } from "@/hooks/use-project";
import { Button } from "@/components/ui/button";
import { DataTable, DataTableColumnHeader, DataTableRowActions, type RowAction } from "@/components/data-table";
import { Badge } from "@/components/ui/badge";

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

const statusColors: Record<string, string> = {
  draft: "bg-muted text-muted-foreground",
  submitted: "bg-amber-500/15 text-amber-500",
  approved: "bg-emerald-500/15 text-emerald-500",
  approved_with_comments: "bg-emerald-500/15 text-emerald-500",
  rejected: "bg-red-500/15 text-red-500",
  superseded: "bg-muted text-muted-foreground",
};

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
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["documents", "MIR", project?.id] }),
  });

  const rowActions: RowAction<Document>[] = [
    { label: "Edit", onClick: (row) => router.push(`/qaqc/mir/new?id=${row.id}`) },
    { label: "Delete", onClick: (row) => deleteMutation.mutate(row.id), destructive: true, separator: true, confirm: "Delete this MIR?" },
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
