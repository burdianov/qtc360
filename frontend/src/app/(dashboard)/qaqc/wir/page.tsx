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

interface Document {
  id: string;
  number: string;
  title: string;
  revision: number;
  status: string;
  created_at: string;
}

const statusColors: Record<string, string> = {
  draft: "bg-muted text-muted-foreground",
  pending_review: "bg-amber-500/15 text-amber-500",
  approved: "bg-emerald-500/15 text-emerald-500",
  rejected: "bg-red-500/15 text-red-500",
};

export default function WIRPage() {
  const router = useRouter();
  const project = useSelectedProject();
  const queryClient = useQueryClient();

  const { data: documents = [], isLoading } = useQuery<Document[]>({
    queryKey: ["documents", "WIR", project?.id],
    queryFn: async () => (await api.get("/documents", { params: { project_id: project!.id, doc_type: "WIR" } })).data,
    enabled: !!project,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/documents/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["documents", "WIR", project?.id] }),
  });

  const rowActions: RowAction<Document>[] = [
    { label: "Edit", onClick: (row) => router.push(`/qaqc/wir/${row.id}`) },
    { label: "Generate PDF", onClick: async (row) => {
      try {
        const res = await api.post(`/reports/generate/WIR`, { document_id: row.id, project_id: project!.id }, { responseType: "blob" });
        const url = URL.createObjectURL(res.data);
        window.open(url, "_blank");
      } catch { toast.error("PDF generation failed"); }
    }},
    { label: "Delete", onClick: (row) => deleteMutation.mutate(row.id), destructive: true, separator: true, confirm: "Are you sure you want to delete this item? This action cannot be undone." },
  ];

  const columns: ColumnDef<Document, unknown>[] = [
    { accessorKey: "number", header: ({ column }) => <DataTableColumnHeader column={column} title="Number" /> },
    { accessorKey: "title", header: ({ column }) => <DataTableColumnHeader column={column} title="Title" /> },
    { accessorKey: "revision", header: ({ column }) => <DataTableColumnHeader column={column} title="Rev" />, meta: { title: "Rev" } },
    { accessorKey: "status", header: ({ column }) => <DataTableColumnHeader column={column} title="Status" />, cell: ({ row }) => <Badge className={statusColors[row.original.status] || ""}>{row.original.status.replace("_", " ")}</Badge> },
    { id: "actions", header: "Actions", cell: ({ row }) => <DataTableRowActions row={row.original} actions={rowActions} /> },
  ];

  if (isLoading) return <div className="p-6">Loading...</div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Work Inspection Requests</h1>
          <p className="text-sm text-muted-foreground">Manage WIR submissions</p>
        </div>
        <Button onClick={() => router.push("/qaqc/wir/new")}><Plus className="mr-2 h-4 w-4" />New WIR</Button>
      </div>
      <DataTable
        columns={columns}
        data={documents}
        searchKey="title"
        searchPlaceholder="Search by title..."
        onRowClick={(row) => router.push(`/qaqc/wir/${row.id}`)}
      />
    </div>
  );
}
