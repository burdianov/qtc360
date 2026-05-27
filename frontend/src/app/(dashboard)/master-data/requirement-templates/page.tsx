"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import api from "@/lib/api";
import { useSelectedProject } from "@/hooks/use-project";
import { DataTable } from "@/components/data-table/data-table";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";
import { toast } from "sonner";

interface RequirementTemplate {
  id: string;
  name: string;
  code: string;
  level_code: string;
  requirement_category: string;
  evidence_document_type: string;
  requires_work_breakdown: boolean;
  is_gate_requirement: boolean;
  is_optional: boolean;
  sort_order: number;
  is_active: boolean;
}

const columns = [
  { accessorKey: "code", header: "Code" },
  { accessorKey: "name", header: "Name" },
  { accessorKey: "level_code", header: "Level" },
  { accessorKey: "requirement_category", header: "Category" },
  { accessorKey: "evidence_document_type", header: "Evidence Type" },
  { accessorKey: "is_gate_requirement", header: "Gate", cell: ({ row }: any) => row.original.is_gate_requirement ? "Yes" : "—" },
  { accessorKey: "requires_work_breakdown", header: "Work Breakdown", cell: ({ row }: any) => row.original.requires_work_breakdown ? "Yes" : "—" },
];

export default function RequirementTemplatesPage() {
  const project = useSelectedProject();

  const { data = [], isLoading } = useQuery<RequirementTemplate[]>({
    queryKey: ["requirement-templates", project?.id],
    queryFn: async () => (await api.get("/commissioning/requirement-templates", { params: { project_id: project?.id } })).data,
    enabled: !!project?.id,
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Requirement Templates</h1>
        <Button size="sm"><Plus className="h-4 w-4 mr-1" />Add Template</Button>
      </div>
      <DataTable columns={columns} data={data} searchKey="name" />
    </div>
  );
}
