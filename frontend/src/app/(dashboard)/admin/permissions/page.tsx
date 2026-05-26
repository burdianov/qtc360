"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { z } from "zod/v4";
import { zodResolver } from "@hookform/resolvers/zod";
import { type ColumnDef } from "@tanstack/react-table";
import { Plus } from "lucide-react";
import api from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DataTable, DataTableColumnHeader, DataTableRowActions, type RowAction } from "@/components/data-table";
import { Form, FormField, FormItem, FormLabel, FormControl, FormMessage } from "@/components/form";

interface Permission { id: string; code: string; description: string | null; }

const schema = z.object({
  code: z.string().min(1, "Code is required"),
  description: z.string(),
});

type FormValues = z.infer<typeof schema>;

export default function PermissionsPage() {
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Permission | null>(null);

  const { data: permissions = [], isLoading } = useQuery<Permission[]>({
    queryKey: ["admin-permissions"],
    queryFn: async () => (await api.get("/admin/permissions")).data,
  });

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { code: "", description: "" },
  });

  const mutation = useMutation({
    mutationFn: async (values: FormValues) => {
      const payload = { ...values, description: values.description || null };
      if (editing) return api.patch(`/admin/permissions/${editing.id}`, payload);
      return api.post("/admin/permissions", payload);
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["admin-permissions"] }); closeDialog(); },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/admin/permissions/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["admin-permissions"] }),
  });

  const openCreate = () => { setEditing(null); form.reset({ code: "", description: "" }); setDialogOpen(true); };
  const openEdit = (item: Permission) => { setEditing(item); form.reset({ code: item.code, description: item.description || "" }); setDialogOpen(true); };
  const closeDialog = () => { setDialogOpen(false); setEditing(null); };

  const rowActions: RowAction<Permission>[] = [
    { label: "Edit", onClick: openEdit },
    { label: "Delete", onClick: (row) => deleteMutation.mutate(row.id), destructive: true, separator: true },
  ];

  const columns: ColumnDef<Permission, unknown>[] = [
    { accessorKey: "code", header: ({ column }) => <DataTableColumnHeader column={column} title="Code" /> },
    { accessorKey: "description", header: ({ column }) => <DataTableColumnHeader column={column} title="Description" />, cell: ({ row }) => row.getValue("description") || "—" },
    { id: "actions", header: "Actions", cell: ({ row }) => <DataTableRowActions row={row.original} actions={rowActions} /> },
  ];

  if (isLoading) return <div className="p-6">Loading...</div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Permissions</h1>
          <p className="text-sm text-muted-foreground">Manage system permissions</p>
        </div>
        <Button onClick={openCreate}><Plus className="mr-2 h-4 w-4" />Add Permission</Button>
      </div>
      <DataTable columns={columns} data={permissions} searchKey="code" searchPlaceholder="Search by code..." />
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editing ? "Edit Permission" : "Add Permission"}</DialogTitle></DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit((v) => mutation.mutate(v))} noValidate className="space-y-4">
              <FormField control={form.control} name="code" render={({ field }) => (<FormItem><FormLabel>Code</FormLabel><FormControl><Input {...field} placeholder="e.g. users.create" /></FormControl><FormMessage /></FormItem>)} />
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
