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
import { DataTable, DataTableColumnHeader, DataTableRowActions, type RowAction } from "@/components/data-table";
import { Form, FormField, FormItem, FormLabel, FormControl, FormMessage } from "@/components/form";
import { useSelectedProject } from "@/hooks/use-project";

interface Test { id: string; name: string; code: string; description: string | null; project_id: string; created_at: string; }

const schema = z.object({
  name: z.string().min(1, "Name is required"),
  code: z.string().min(1, "Code is required"),
  description: z.string(),
});

type FormValues = z.infer<typeof schema>;

export default function TestsPage() {
  const queryClient = useQueryClient();
  const selectedProject = useSelectedProject();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Test | null>(null);

  const { data: allTests = [], isLoading } = useQuery<Test[]>({
    queryKey: ["tests"],
    queryFn: async () => (await api.get("/tests")).data,
  });

  const tests = allTests.filter((t) => t.project_id === selectedProject?.id);

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { name: "", code: "", description: "" },
  });

  const mutation = useMutation({
    mutationFn: async (values: FormValues) => {
      const payload = { ...values, description: values.description || null, project_id: selectedProject?.id };
      if (editing) return api.patch(`/tests/${editing.id}`, payload);
      return api.post("/tests", payload);
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["tests"] }); closeDialog(); },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/tests/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["tests"] }),
  });

  const openCreate = () => { setEditing(null); form.reset({ name: "", code: "", description: "" }); setDialogOpen(true); };
  const openEdit = (item: Test) => { setEditing(item); form.reset({ name: item.name, code: item.code, description: item.description || "" }); setDialogOpen(true); };
  const closeDialog = () => { setDialogOpen(false); setEditing(null); };

  const rowActions: RowAction<Test>[] = [
    { label: "Edit", onClick: openEdit },
    { label: "Delete", onClick: (row) => deleteMutation.mutate(row.id), destructive: true, separator: true },
  ];

  const columns: ColumnDef<Test, unknown>[] = [
    { accessorKey: "code", header: ({ column }) => <DataTableColumnHeader column={column} title="Code" /> },
    { accessorKey: "name", header: ({ column }) => <DataTableColumnHeader column={column} title="Name" /> },
    { accessorKey: "description", header: ({ column }) => <DataTableColumnHeader column={column} title="Description" />, cell: ({ row }) => row.getValue("description") || "—" },
    { id: "actions", header: "Actions", cell: ({ row }) => <DataTableRowActions row={row.original} actions={rowActions} /> },
  ];

  if (isLoading) return <div className="p-6">Loading...</div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Tests</h1>
          <p className="text-sm text-muted-foreground">Manage tests for the current project</p>
        </div>
        <Button onClick={openCreate}><Plus className="mr-2 h-4 w-4" />Add Test</Button>
      </div>
      <DataTable
        columns={columns}
        data={tests}
        searchKey="name"
        searchPlaceholder="Search by name..."
        onExport={(rows) => exportToCsv(rows, "tests")}
        onImport={async (file) => {
          const rows = await parseCsv(file);
          for (const row of rows) await api.post("/tests", { ...row, project_id: selectedProject?.id });
          queryClient.invalidateQueries({ queryKey: ["tests"] });
        }}
        onDownloadTemplate={() => downloadTemplate(["name", "code", "description"], "tests")}
        onBulkDelete={async (rows) => {
          for (const row of rows) await api.delete(`/tests/${row.id}`);
          queryClient.invalidateQueries({ queryKey: ["tests"] });
        }}
      />
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editing ? "Edit Test" : "Add Test"}</DialogTitle></DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit((v) => mutation.mutate(v))} noValidate className="space-y-4">
              <FormField control={form.control} name="name" render={({ field }) => (<FormItem><FormLabel>Name</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>)} />
              <FormField control={form.control} name="code" render={({ field }) => (<FormItem><FormLabel>Code</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>)} />
              <FormField control={form.control} name="description" render={({ field }) => (<FormItem><FormLabel>Description</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>)} />
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
