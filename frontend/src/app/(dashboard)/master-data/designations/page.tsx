"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { z } from "zod/v4";
import { zodResolver } from "@hookform/resolvers/zod";
import { type ColumnDef } from "@tanstack/react-table";
import { Plus } from "lucide-react";
import api from "@/lib/api";
import { exportToCsv, parseCsv, downloadTemplate } from "@/lib/csv";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DataTable, DataTableColumnHeader, DataTableRowActions, type RowAction, type EditableColumn } from "@/components/data-table";
import { Form, FormField, FormItem, FormLabel, FormControl, FormMessage } from "@/components/form";

interface Designation { id: string; name: string; created_at: string; }

const schema = z.object({ name: z.string().min(1, "Name is required") });
type FormValues = z.infer<typeof schema>;

export default function DesignationsPage() {
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Designation | null>(null);

  const { data: designations = [], isLoading } = useQuery<Designation[]>({
    queryKey: ["designations"],
    queryFn: async () => (await api.get("/designations")).data,
  });

  const form = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: { name: "" } });

  const mutation = useMutation({
    mutationFn: async (values: FormValues) => {
      if (editing) return api.patch(`/designations/${editing.id}`, values);
      return api.post("/designations", values);
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["designations"] }); setDialogOpen(false); setEditing(null); },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/designations/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["designations"] }),
  });

  const inlineUpdate = async (row: Designation, updates: Record<string, any>) => {
    await api.patch(`/designations/${row.id}`, updates);
    queryClient.invalidateQueries({ queryKey: ["designations"] });
  };

  const editableCols: Record<string, EditableColumn> = { name: { type: "text" } };

  const openCreate = () => { setEditing(null); form.reset({ name: "" }); setDialogOpen(true); };
  const openEdit = (item: Designation) => { setEditing(item); form.reset({ name: item.name }); setDialogOpen(true); };

  const rowActions: RowAction<Designation>[] = [
    { label: "Edit", onClick: openEdit },
    { label: "Delete", onClick: (row) => deleteMutation.mutate(row.id), destructive: true, separator: true, confirm: "Are you sure?" },
  ];

  const columns: ColumnDef<Designation, unknown>[] = [
    { accessorKey: "name", header: ({ column }) => <DataTableColumnHeader column={column} title="Name" /> },
    { id: "actions", header: "Actions", cell: ({ row }) => <DataTableRowActions row={row.original} actions={rowActions} /> },
  ];

  if (isLoading) return <div className="p-6">Loading...</div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Designations</h1>
          <p className="text-sm text-muted-foreground">Manage job designations / titles</p>
        </div>
        <Button onClick={openCreate}><Plus className="mr-2 h-4 w-4" />Add Designation</Button>
      </div>
      <DataTable
        columns={columns}
        data={designations}
        searchKey="name"
        searchPlaceholder="Search by name..."
        editableColumns={editableCols}
        onRowUpdate={inlineUpdate}
        onExport={(rows) => exportToCsv(rows, "designations")}
        onImport={async (file) => {
          const rows = await parseCsv(file);
          await Promise.allSettled(rows.map((row) => api.post("/designations", row)));
          queryClient.invalidateQueries({ queryKey: ["designations"] });
        }}
        onDownloadTemplate={() => downloadTemplate(["name"], "designations")}
        onBulkDelete={async (rows) => {
          await Promise.allSettled(rows.map((row) => api.delete(`/designations/${row.id}`)));
          queryClient.invalidateQueries({ queryKey: ["designations"] });
        }}
      />
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editing ? "Edit Designation" : "Add Designation"}</DialogTitle></DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit((v) => mutation.mutate(v))} noValidate className="space-y-4">
              <FormField control={form.control} name="name" render={({ field }) => (<FormItem><FormLabel>Name</FormLabel><FormControl><Input {...field} placeholder="e.g. QA/QC Engineer" /></FormControl><FormMessage /></FormItem>)} />
              <div className="flex justify-end gap-2 pt-2">
                <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
                <Button type="submit" disabled={mutation.isPending}>{mutation.isPending ? "Saving..." : editing ? "Update" : "Create"}</Button>
              </div>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
