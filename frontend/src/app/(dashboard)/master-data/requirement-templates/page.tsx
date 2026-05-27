"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { z } from "zod/v4";
import { zodResolver } from "@hookform/resolvers/zod";
import { type ColumnDef } from "@tanstack/react-table";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import api from "@/lib/api";
import { useSelectedProject } from "@/hooks/use-project";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DataTable, DataTableColumnHeader, DataTableRowActions, type RowAction } from "@/components/data-table";
import { Form, FormField, FormItem, FormLabel, FormControl, FormMessage } from "@/components/form";

interface RequirementTemplate {
  id: string;
  name: string;
  code: string;
  description: string | null;
  level_code: string;
  requirement_category: string;
  evidence_document_type: string;
  requires_work_breakdown: boolean;
  is_gate_requirement: boolean;
  is_optional: boolean;
  sort_order: number;
}

const schema = z.object({
  name: z.string().min(1, "Name is required"),
  code: z.string().min(1, "Code is required"),
  description: z.string().optional(),
  level_code: z.string().min(1, "Level is required"),
  requirement_category: z.string().min(1, "Category is required"),
  evidence_document_type: z.string().min(1, "Evidence type is required"),
  requires_work_breakdown: z.boolean(),
  is_gate_requirement: z.boolean(),
  is_optional: z.boolean(),
  sort_order: z.number(),
});

type FormValues = z.infer<typeof schema>;

const LEVELS = ["L1", "L2A", "L2B", "L3", "L4"];
const CATEGORIES = ["fat", "delivery", "activity", "test", "integration_test", "final_level_test"];
const EVIDENCE_TYPES = ["FAT", "MIR", "WIR", "CIR"];

const defaultValues: FormValues = {
  name: "", code: "", description: "", level_code: "", requirement_category: "",
  evidence_document_type: "", requires_work_breakdown: false, is_gate_requirement: false,
  is_optional: false, sort_order: 0,
};

export default function RequirementTemplatesPage() {
  const project = useSelectedProject();
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<RequirementTemplate | null>(null);

  const { data: templates = [], isLoading } = useQuery<RequirementTemplate[]>({
    queryKey: ["requirement-templates", project?.id],
    queryFn: async () => (await api.get("/commissioning/requirement-templates", { params: { project_id: project!.id } })).data,
    enabled: !!project,
  });

  const form = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues });

  const mutation = useMutation({
    mutationFn: async (values: FormValues) => {
      if (editing) return api.patch(`/commissioning/requirement-templates/${editing.id}`, values);
      return api.post("/commissioning/requirement-templates", { ...values, project_id: project!.id });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["requirement-templates", project?.id] });
      toast.success(editing ? "Template updated" : "Template created");
      closeDialog();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/commissioning/requirement-templates/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["requirement-templates", project?.id] });
      toast.success("Template deleted");
    },
  });

  const openCreate = () => { setEditing(null); form.reset(defaultValues); setDialogOpen(true); };
  const openEdit = (item: RequirementTemplate) => {
    setEditing(item);
    form.reset({ name: item.name, code: item.code, description: item.description || "", level_code: item.level_code, requirement_category: item.requirement_category, evidence_document_type: item.evidence_document_type, requires_work_breakdown: item.requires_work_breakdown, is_gate_requirement: item.is_gate_requirement, is_optional: item.is_optional, sort_order: item.sort_order });
    setDialogOpen(true);
  };
  const closeDialog = () => { setDialogOpen(false); setEditing(null); };

  const rowActions: RowAction<RequirementTemplate>[] = [
    { label: "Edit", onClick: openEdit },
    { label: "Delete", onClick: (row) => deleteMutation.mutate(row.id), destructive: true, separator: true, confirm: "Are you sure you want to delete this template? This action cannot be undone." },
  ];

  const columns: ColumnDef<RequirementTemplate, unknown>[] = [
    { accessorKey: "code", header: ({ column }) => <DataTableColumnHeader column={column} title="Code" /> },
    { accessorKey: "name", header: ({ column }) => <DataTableColumnHeader column={column} title="Name" /> },
    { accessorKey: "level_code", header: ({ column }) => <DataTableColumnHeader column={column} title="Level" />, cell: ({ row }) => {
      const colors: Record<string, string> = { L1: "bg-red-500/15 text-red-500", L2A: "bg-red-500/15 text-red-500", L2B: "bg-yellow-500/15 text-yellow-600", L3: "bg-emerald-500/15 text-emerald-500", L4: "bg-blue-500/15 text-blue-500" };
      return <Badge className={colors[row.original.level_code] || ""}>{row.original.level_code}</Badge>;
    }},
    { accessorKey: "requirement_category", header: ({ column }) => <DataTableColumnHeader column={column} title="Category" />, cell: ({ row }) => row.original.requirement_category.replace(/_/g, " ") },
    { accessorKey: "evidence_document_type", header: ({ column }) => <DataTableColumnHeader column={column} title="Evidence Type" /> },
    { accessorKey: "is_gate_requirement", header: ({ column }) => <DataTableColumnHeader column={column} title="Gate" />, cell: ({ row }) => row.original.is_gate_requirement ? "Yes" : "—" },
    { accessorKey: "requires_work_breakdown", header: ({ column }) => <DataTableColumnHeader column={column} title="Work Breakdown" />, cell: ({ row }) => row.original.requires_work_breakdown ? "Yes" : "—" },
    { id: "actions", header: "Actions", cell: ({ row }) => <DataTableRowActions row={row.original} actions={rowActions} /> },
  ];

  if (isLoading) return <div className="p-6">Loading...</div>;

  return (
    <div className="space-y-6 min-w-0">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Requirement Templates</h1>
          <p className="text-sm text-muted-foreground">Manage commissioning requirement templates</p>
        </div>
        <Button onClick={openCreate}><Plus className="mr-2 h-4 w-4" />New Template</Button>
      </div>
      <DataTable columns={columns} data={templates} searchKey="name" searchPlaceholder="Search by name..." />
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editing ? "Edit Template" : "New Template"}</DialogTitle></DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit((v) => mutation.mutate(v))} noValidate className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <FormField control={form.control} name="code" render={({ field }) => (<FormItem><FormLabel>Code</FormLabel><FormControl><Input {...field} disabled={!!editing} /></FormControl><FormMessage /></FormItem>)} />
                <FormField control={form.control} name="name" render={({ field }) => (<FormItem><FormLabel>Name</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>)} />
              </div>
              <FormField control={form.control} name="description" render={({ field }) => (<FormItem><FormLabel>Description</FormLabel><FormControl><Textarea {...field} /></FormControl><FormMessage /></FormItem>)} />
              <div className="grid grid-cols-3 gap-4">
                <FormField control={form.control} name="level_code" render={({ field }) => (
                  <FormItem><FormLabel>Level</FormLabel><FormControl>
                    <Select value={field.value} onValueChange={(v: any) => field.onChange(v)}>
                      <SelectTrigger><SelectValue placeholder="Select level">{field.value || ""}</SelectValue></SelectTrigger>
                      <SelectContent>{LEVELS.map((l) => <SelectItem key={l} value={l}>{l}</SelectItem>)}</SelectContent>
                    </Select>
                  </FormControl><FormMessage /></FormItem>
                )} />
                <FormField control={form.control} name="requirement_category" render={({ field }) => (
                  <FormItem><FormLabel>Category</FormLabel><FormControl>
                    <Select value={field.value} onValueChange={(v: any) => field.onChange(v)}>
                      <SelectTrigger><SelectValue placeholder="Select category">{field.value ? field.value.replace(/_/g, " ") : ""}</SelectValue></SelectTrigger>
                      <SelectContent>{CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c.replace(/_/g, " ")}</SelectItem>)}</SelectContent>
                    </Select>
                  </FormControl><FormMessage /></FormItem>
                )} />
                <FormField control={form.control} name="evidence_document_type" render={({ field }) => (
                  <FormItem><FormLabel>Evidence Type</FormLabel><FormControl>
                    <Select value={field.value} onValueChange={(v: any) => field.onChange(v)}>
                      <SelectTrigger><SelectValue placeholder="Select type">{field.value || ""}</SelectValue></SelectTrigger>
                      <SelectContent>{EVIDENCE_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
                    </Select>
                  </FormControl><FormMessage /></FormItem>
                )} />
              </div>
              <FormField control={form.control} name="sort_order" render={({ field }) => (<FormItem><FormLabel>Sort Order</FormLabel><FormControl><Input type="number" {...field} onChange={(e) => field.onChange(Number(e.target.value))} /></FormControl><FormMessage /></FormItem>)} />
              <div className="grid grid-cols-3 gap-4">
                <FormField control={form.control} name="is_gate_requirement" render={({ field }) => (<FormItem className="flex items-center gap-2 space-y-0"><FormControl><Checkbox checked={field.value} onCheckedChange={field.onChange} /></FormControl><FormLabel>Gate Requirement</FormLabel></FormItem>)} />
                <FormField control={form.control} name="requires_work_breakdown" render={({ field }) => (<FormItem className="flex items-center gap-2 space-y-0"><FormControl><Checkbox checked={field.value} onCheckedChange={field.onChange} /></FormControl><FormLabel>Work Breakdown</FormLabel></FormItem>)} />
                <FormField control={form.control} name="is_optional" render={({ field }) => (<FormItem className="flex items-center gap-2 space-y-0"><FormControl><Checkbox checked={field.value} onCheckedChange={field.onChange} /></FormControl><FormLabel>Optional</FormLabel></FormItem>)} />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <Button type="button" variant="outline" onClick={closeDialog}>Cancel</Button>
                <Button type="submit" disabled={mutation.isPending}>{mutation.isPending ? "Saving..." : editing ? "Update" : "Create"}</Button>
              </div>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
