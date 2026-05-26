"use client";

import { useRouter } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { type ColumnDef } from "@tanstack/react-table";
import { Plus } from "lucide-react";
import api from "@/lib/api";
import { useSelectedProject } from "@/hooks/use-project";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { DataTable, DataTableColumnHeader, DataTableRowActions, type RowAction } from "@/components/data-table";

interface Template {
  id: string;
  name: string;
  doc_type: string;
  created_at: string;
}

export default function TemplatesPage() {
  const router = useRouter();
  const project = useSelectedProject();
  const queryClient = useQueryClient();

  const { data: templates = [], isLoading } = useQuery<Template[]>({
    queryKey: ["templates", project?.id],
    queryFn: async () => (await api.get("/templates", { params: { project_id: project!.id } })).data,
    enabled: !!project,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/templates/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["templates", project?.id] }),
  });

  const rowActions: RowAction<Template>[] = [
    { label: "Edit", onClick: (row) => router.push(`/documents/templates/builder?id=${row.id}`) },
    { label: "Delete", onClick: (row) => deleteMutation.mutate(row.id), destructive: true, separator: true, confirm: "Are you sure you want to delete this template? This action cannot be undone." },
  ];

  const columns: ColumnDef<Template, unknown>[] = [
    { accessorKey: "name", header: ({ column }) => <DataTableColumnHeader column={column} title="Name" /> },
    { accessorKey: "doc_type", header: ({ column }) => <DataTableColumnHeader column={column} title="Type" />, cell: ({ row }) => <Badge variant="secondary">{row.original.doc_type}</Badge> },
    { id: "actions", header: "Actions", cell: ({ row }) => <DataTableRowActions row={row.original} actions={rowActions} /> },
  ];

  if (isLoading) return <div className="p-6">Loading...</div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Templates</h1>
          <p className="text-sm text-muted-foreground">Document cover sheet templates</p>
        </div>
        <Button onClick={() => router.push("/documents/templates/builder")}>
          <Plus className="mr-2 h-4 w-4" />New Template
        </Button>
      </div>
      <DataTable columns={columns} data={templates} searchKey="name" searchPlaceholder="Search templates..." />
    </div>
  );
}
