"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRouter, useSearchParams } from "next/navigation";
import { type ColumnDef } from "@tanstack/react-table";
import api from "@/lib/api";
import { formatDate } from "@/lib/format-date";
import { useSelectedProject } from "@/hooks/use-project";
import {
  DataTable,
  DataTableColumnHeader,
  DataTableRowActions,
  type RowAction,
} from "@/components/data-table";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { statusColors } from "@/lib/constants";
import { TableSkeleton } from "@/components/loaders/table-skeleton";

interface Document {
  id: string;
  document_type: string;
  reference_no: string;
  title: string;
  revision_no: number;
  full_reference_no?: string;
  status: string;
  current_approver_order: number | null;
  created_at: string;
}

const typeColors: Record<string, string> = {
  WIR: "bg-blue-500/15 text-blue-500",
  CIR: "bg-purple-500/15 text-purple-500",
  MIR: "bg-orange-500/15 text-orange-500",
  FAT: "bg-emerald-500/15 text-emerald-500",
};

export default function DocumentsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const project = useSelectedProject();
  const [filterType, setFilterType] = useState(searchParams.get("type") || "");
  const [filterStatus, setFilterStatus] = useState(
    searchParams.get("status") || "",
  );
  const [filterDiscipline] = useState(searchParams.get("discipline") || "");

  const { data: documents = [], isLoading } = useQuery<Document[]>({
    queryKey: [
      "documents",
      "all",
      project?.id,
      filterType,
      filterStatus,
      filterDiscipline,
    ],
    queryFn: async () => {
      const params: any = { project_id: project!.id };
      if (filterType) params.document_type = filterType;
      if (filterStatus) params.status = filterStatus;
      if (filterDiscipline) params.discipline_id = filterDiscipline;
      return (await api.get("/documents", { params })).data;
    },
    enabled: !!project,
  });

  const formUrl = (doc: Document) =>
    `/qaqc/${doc.document_type.toLowerCase()}/new?id=${doc.id}`;

  const rowActions: RowAction<Document>[] = [
    { label: "Open", onClick: (row) => router.push(formUrl(row)) },
  ];

  const columns: ColumnDef<Document, unknown>[] = [
    {
      accessorKey: "document_type",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="Type" />
      ),
      cell: ({ row }) => (
        <Badge className={typeColors[row.original.document_type] || ""}>
          {row.original.document_type}
        </Badge>
      ),
    },
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
    { accessorKey: "revision_no", header: "Rev" },
    {
      accessorKey: "status",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="Status" />
      ),
      cell: ({ row }) => {
        const { status, current_approver_order } = row.original;
        const label =
          status === "submitted" && current_approver_order
            ? `Pending Approver ${current_approver_order}`
            : status.replace(/_/g, " ");
        return <Badge className={statusColors[status] || ""}>{label}</Badge>;
      },
    },
    {
      id: "actions",
      header: "Actions",
      cell: ({ row }) => (
        <DataTableRowActions row={row.original} actions={rowActions} />
      ),
    },
    {
      accessorKey: "created_at",
      header: "Created",
      cell: ({ row }) => (
        <span className="text-xs text-muted-foreground">
          {formatDate(row.original.created_at)}
        </span>
      ),
    },
  ];

  if (isLoading) return <TableSkeleton />;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            All Documents
          </h1>
          <p className="text-sm text-muted-foreground">
            View all QA/QC and commissioning documents
          </p>
        </div>
        <div className="flex gap-2">
          <Select
            value={filterStatus || "__all__"}
            onValueChange={(v: any) =>
              setFilterStatus(v === "__all__" ? "" : v)
            }
          >
            <SelectTrigger className="w-44">
              <SelectValue>
                {filterStatus
                  ? filterStatus.replace(/_/g, " ")
                  : "All Statuses"}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">All Statuses</SelectItem>
              <SelectItem value="draft">Draft</SelectItem>
              <SelectItem value="internally_signed">
                Internally Signed
              </SelectItem>
              <SelectItem value="with_approver_1">With Approver 1</SelectItem>
              <SelectItem value="approver_1_returned">
                Approver 1 Returned
              </SelectItem>
              <SelectItem value="with_approver_2">With Approver 2</SelectItem>
              <SelectItem value="approved">Approved</SelectItem>
              <SelectItem value="approved_with_comments">
                Approved (B)
              </SelectItem>
              <SelectItem value="rejected">Rejected</SelectItem>
            </SelectContent>
          </Select>
          <Select
            value={filterType || "__all__"}
            onValueChange={(v: any) => setFilterType(v === "__all__" ? "" : v)}
          >
            <SelectTrigger className="w-32">
              <SelectValue placeholder="All Types">
                {filterType || "All Types"}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">All Types</SelectItem>
              <SelectItem value="WIR">WIR</SelectItem>
              <SelectItem value="CIR">CIR</SelectItem>
              <SelectItem value="MIR">MIR</SelectItem>
              <SelectItem value="FAT">FAT</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <DataTable
        columns={columns}
        data={documents}
        searchKey="title"
        searchPlaceholder="Search documents..."
      />
    </div>
  );
}
