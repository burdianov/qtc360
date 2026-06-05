"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { type ColumnDef } from "@tanstack/react-table";
import { Plus } from "lucide-react";
import api from "@/lib/api";
import { useSelectedProject } from "@/hooks/use-project";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DataTable,
  DataTableColumnHeader,
  DataTableRowActions,
  type RowAction,
} from "@/components/data-table";
import { Badge } from "@/components/ui/badge";
import { statusColors } from "@/lib/constants";
import { formatDate } from "@/lib/format-date";

interface Document {
  id: string;
  reference_no: string;
  title: string;
  revision_no: number;
  full_reference_no?: string;
  status: string;
  created_at: string;
}

export default function CRSPage() {
  const router = useRouter();
  const project = useSelectedProject();
  const queryClient = useQueryClient();

  const { data: documents = [], isLoading } = useQuery<Document[]>({
    queryKey: ["documents", "CRS", project?.id],
    queryFn: async () =>
      (
        await api.get("/documents", {
          params: { project_id: project!.id, document_type: "CRS" },
        })
      ).data,
    enabled: !!project,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/documents/${id}`),
    onSuccess: () => {
      toast.success("CRS deleted");
      queryClient.invalidateQueries({
        queryKey: ["documents", "CRS", project?.id],
      });
    },
    onError: (err: unknown) => {
      const detail = (err as { response?: { data?: { detail?: string } } })
        ?.response?.data?.detail;
      toast.error(detail || "Failed to delete CRS");
    },
  });

  const rowActions: RowAction<Document>[] = [
    {
      label: "Edit",
      onClick: (row) => router.push(`/qaqc/crs/new?id=${row.id}`),
    },
    {
      label: "Delete",
      onClick: (row) => deleteMutation.mutate(row.id),
      destructive: true,
      separator: true,
      confirm: "Are you sure you want to delete this CRS?",
    },
  ];

  const columns: ColumnDef<Document, unknown>[] = [
    {
      accessorKey: "reference_no",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="Number" />
      ),
      cell: ({ row }) =>
        row.original.full_reference_no || row.original.reference_no,
    },
    {
      accessorKey: "title",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="Title" />
      ),
    },
    {
      accessorKey: "revision_no",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="Rev" />
      ),
    },
    {
      accessorKey: "status",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="Status" />
      ),
      cell: ({ row }) => (
        <Badge className={statusColors[row.original.status] || ""}>
          {row.original.status.replace(/_/g, " ")}
        </Badge>
      ),
    },
    {
      accessorKey: "created_at",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="Created" />
      ),
      cell: ({ row }) => formatDate(row.original.created_at),
    },
    {
      id: "actions",
      header: "Actions",
      cell: ({ row }) => (
        <DataTableRowActions row={row.original} actions={rowActions} />
      ),
    },
  ];

  if (isLoading) return <div className="p-6">Loading...</div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Comment Response Sheets
          </h1>
          <p className="text-sm text-muted-foreground">
            Manage CRS submissions
          </p>
        </div>
        <Button onClick={() => router.push("/qaqc/crs/new")}>
          <Plus className="mr-2 h-4 w-4" />
          New CRS
        </Button>
      </div>
      <DataTable
        columns={columns}
        data={documents}
        searchKey="title"
        searchPlaceholder="Search by title..."
      />
    </div>
  );
}
