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
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DataTable, DataTableColumnHeader, DataTableRowActions, type RowAction } from "@/components/data-table";
import { Form, FormField, FormItem, FormLabel, FormControl, FormMessage } from "@/components/form";
import { Badge } from "@/components/ui/badge";

interface Document {
  id: string;
  reference_no: string;
  title: string;
  revision_no: number;
  status: string;
  delivery_note: string | null;
  created_at: string;
}

const schema = z.object({
  reference_no: z.string().min(1, "Reference number is required"),
  title: z.string().min(1, "Title is required"),
  delivery_note: z.string().optional(),
});

type FormValues = z.infer<typeof schema>;

const statusColors: Record<string, string> = {
  draft: "bg-muted text-muted-foreground",
  submitted: "bg-amber-500/15 text-amber-500",
  approved: "bg-emerald-500/15 text-emerald-500",
  approved_with_comments: "bg-emerald-500/15 text-emerald-500",
  rejected: "bg-red-500/15 text-red-500",
};

export default function MIRPage() {
  const project = useSelectedProject();
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Document | null>(null);

  const { data: documents = [], isLoading } = useQuery<Document[]>({
    queryKey: ["documents", "MIR", project?.id],
    queryFn: async () => (await api.get("/documents", { params: { project_id: project!.id, document_type: "MIR" } })).data,
    enabled: !!project,
  });

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { reference_no: "", title: "", delivery_note: "" },
  });

  const mutation = useMutation({
    mutationFn: async (values: FormValues) => {
      if (editing) return api.patch(`/documents/${editing.id}`, { title: values.title, delivery_note: values.delivery_note || null });
      return api.post("/documents", { ...values, project_id: project!.id, document_type: "MIR" });
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["documents", "MIR", project?.id] }); closeDialog(); },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/documents/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["documents", "MIR", project?.id] }),
  });

  const openCreate = () => { setEditing(null); form.reset({ reference_no: "", title: "", delivery_note: "" }); setDialogOpen(true); };
  const openEdit = (item: Document) => { setEditing(item); form.reset({ reference_no: item.reference_no, title: item.title, delivery_note: item.delivery_note || "" }); setDialogOpen(true); };
  const closeDialog = () => { setDialogOpen(false); setEditing(null); };

  const rowActions: RowAction<Document>[] = [
    { label: "Edit", onClick: openEdit },
    { label: "Delete", onClick: (row) => deleteMutation.mutate(row.id), destructive: true, separator: true, confirm: "Are you sure you want to delete this item? This action cannot be undone." },
  ];

  const columns: ColumnDef<Document, unknown>[] = [
    { accessorKey: "reference_no", header: ({ column }) => <DataTableColumnHeader column={column} title="Number" /> },
    { accessorKey: "title", header: ({ column }) => <DataTableColumnHeader column={column} title="Title" /> },
    { accessorKey: "revision_no", header: ({ column }) => <DataTableColumnHeader column={column} title="Rev" />, meta: { title: "Rev" } },
    { accessorKey: "status", header: ({ column }) => <DataTableColumnHeader column={column} title="Status" />, cell: ({ row }) => <Badge className={statusColors[row.original.status] || ""}>{row.original.status.replace(/_/g, " ")}</Badge> },
    { accessorKey: "delivery_note", header: ({ column }) => <DataTableColumnHeader column={column} title="Delivery Note" /> },
    { id: "actions", header: "Actions", cell: ({ row }) => <DataTableRowActions row={row.original} actions={rowActions} /> },
  ];

  if (isLoading) return <div className="p-6">Loading...</div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Material Inspection Requests</h1>
          <p className="text-sm text-muted-foreground">Manage MIR submissions</p>
        </div>
        <Button onClick={openCreate}><Plus className="mr-2 h-4 w-4" />New MIR</Button>
      </div>
      <DataTable columns={columns} data={documents} searchKey="title" searchPlaceholder="Search by title..." />
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editing ? "Edit MIR" : "New MIR"}</DialogTitle></DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit((v) => mutation.mutate(v))} noValidate className="space-y-4">
              <FormField control={form.control} name="reference_no" render={({ field }) => (<FormItem><FormLabel>Reference No</FormLabel><FormControl><Input {...field} disabled={!!editing} /></FormControl><FormMessage /></FormItem>)} />
              <FormField control={form.control} name="title" render={({ field }) => (<FormItem><FormLabel>Title</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>)} />
              <FormField control={form.control} name="delivery_note" render={({ field }) => (<FormItem><FormLabel>Delivery Note</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>)} />
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
