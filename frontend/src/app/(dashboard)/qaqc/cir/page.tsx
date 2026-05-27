"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { z } from "zod/v4";
import { zodResolver } from "@hookform/resolvers/zod";
import { type ColumnDef } from "@tanstack/react-table";
import { Plus } from "lucide-react";
import api from "@/lib/api";
import { useSelectedProject } from "@/hooks/use-project";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DataTable, DataTableColumnHeader, DataTableRowActions, type RowAction } from "@/components/data-table";
import { Form, FormField, FormItem, FormLabel, FormControl, FormMessage } from "@/components/form";
import { Badge } from "@/components/ui/badge";

interface Test { id: string; name: string; code: string; }
interface Document {
  id: string;
  number: string;
  title: string;
  revision: number;
  status: string;
  test_id: string | null;
  is_milestone_test: boolean | null;
  created_at: string;
}

const schema = z.object({
  number: z.string().min(1, "Number is required"),
  title: z.string().min(1, "Title is required"),
  test_id: z.string().optional(),
  is_milestone_test: z.boolean().optional(),
});

type FormValues = z.infer<typeof schema>;

const statusColors: Record<string, string> = {
  draft: "bg-muted text-muted-foreground",
  pending_review: "bg-amber-500/15 text-amber-500",
  approved: "bg-emerald-500/15 text-emerald-500",
  rejected: "bg-red-500/15 text-red-500",
};

export default function CIRPage() {
  const project = useSelectedProject();
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Document | null>(null);

  const { data: documents = [], isLoading } = useQuery<Document[]>({
    queryKey: ["documents", "CIR", project?.id],
    queryFn: async () => (await api.get("/documents", { params: { project_id: project!.id, doc_type: "CIR" } })).data,
    enabled: !!project,
  });

  const { data: tests = [] } = useQuery<Test[]>({
    queryKey: ["tests"],
    queryFn: async () => (await api.get("/tests")).data,
  });

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { number: "", title: "", test_id: "", is_milestone_test: false },
  });

  const mutation = useMutation({
    mutationFn: async (values: FormValues) => {
      const payload = { ...values, test_id: values.test_id || null };
      if (editing) return api.patch(`/documents/${editing.id}`, payload);
      return api.post("/documents", { ...payload, project_id: project!.id, doc_type: "CIR" });
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["documents", "CIR", project?.id] }); closeDialog(); },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/documents/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["documents", "CIR", project?.id] }),
  });

  const openCreate = () => { setEditing(null); form.reset({ number: "", title: "", test_id: "", is_milestone_test: false }); setDialogOpen(true); };
  const openEdit = (item: Document) => { setEditing(item); form.reset({ number: item.number, title: item.title, test_id: item.test_id || "", is_milestone_test: item.is_milestone_test || false }); setDialogOpen(true); };
  const closeDialog = () => { setDialogOpen(false); setEditing(null); };

  const rowActions: RowAction<Document>[] = [
    { label: "Edit", onClick: openEdit },
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
          <h1 className="text-2xl font-semibold tracking-tight">Commissioning Inspection Requests</h1>
          <p className="text-sm text-muted-foreground">Manage CIR submissions</p>
        </div>
        <Button onClick={openCreate}><Plus className="mr-2 h-4 w-4" />New CIR</Button>
      </div>
      <DataTable columns={columns} data={documents} searchKey="title" searchPlaceholder="Search by title..." />
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editing ? "Edit CIR" : "New CIR"}</DialogTitle></DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit((v) => mutation.mutate(v))} noValidate className="space-y-4">
              <FormField control={form.control} name="number" render={({ field }) => (<FormItem><FormLabel>Number</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>)} />
              <FormField control={form.control} name="title" render={({ field }) => (<FormItem><FormLabel>Title</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>)} />
              <FormField control={form.control} name="test_id" render={({ field }) => (
                <FormItem>
                  <FormLabel>Test</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl><SelectTrigger><SelectValue placeholder="Select test" /></SelectTrigger></FormControl>
                    <SelectContent>
                      {tests.map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="is_milestone_test" render={({ field }) => (
                <FormItem className="flex items-center gap-2">
                  <FormControl><Checkbox checked={field.value} onCheckedChange={field.onChange} /></FormControl>
                  <FormLabel className="!mt-0">Milestone Test</FormLabel>
                </FormItem>
              )} />
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
