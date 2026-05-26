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
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DataTable, DataTableColumnHeader, DataTableRowActions, type RowAction } from "@/components/data-table";
import { Form, FormField, FormItem, FormLabel, FormControl, FormMessage } from "@/components/form";
import { Badge } from "@/components/ui/badge";

interface Permission { id: string; code: string; description: string | null; }
interface RoleItem { id: string; name: string; description: string | null; permissions: Permission[]; }

const schema = z.object({
  name: z.string().min(1, "Name is required"),
  description: z.string(),
  permission_ids: z.array(z.string()),
});

type FormValues = z.infer<typeof schema>;

export default function RolesPage() {
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<RoleItem | null>(null);

  const { data: roles = [], isLoading } = useQuery<RoleItem[]>({
    queryKey: ["admin-roles"],
    queryFn: async () => (await api.get("/admin/roles")).data,
  });

  const { data: permissions = [] } = useQuery<Permission[]>({
    queryKey: ["admin-permissions"],
    queryFn: async () => (await api.get("/admin/permissions")).data,
  });

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { name: "", description: "", permission_ids: [] },
  });

  const mutation = useMutation({
    mutationFn: async (values: FormValues) => {
      const payload = { ...values, description: values.description || null };
      if (editing) return api.patch(`/admin/roles/${editing.id}`, payload);
      return api.post("/admin/roles", payload);
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["admin-roles"] }); closeDialog(); },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/admin/roles/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["admin-roles"] }),
  });

  const openCreate = () => { setEditing(null); form.reset({ name: "", description: "", permission_ids: [] }); setDialogOpen(true); };
  const openEdit = (item: RoleItem) => { setEditing(item); form.reset({ name: item.name, description: item.description || "", permission_ids: item.permissions.map((p) => p.id) }); setDialogOpen(true); };
  const closeDialog = () => { setDialogOpen(false); setEditing(null); };

  const rowActions: RowAction<RoleItem>[] = [
    { label: "Edit", onClick: openEdit },
    { label: "Delete", onClick: (row) => deleteMutation.mutate(row.id), destructive: true, separator: true },
  ];

  const columns: ColumnDef<RoleItem, unknown>[] = [
    { accessorKey: "name", header: ({ column }) => <DataTableColumnHeader column={column} title="Name" /> },
    { accessorKey: "description", header: ({ column }) => <DataTableColumnHeader column={column} title="Description" />, cell: ({ row }) => row.getValue("description") || "—" },
    { id: "permissions", accessorFn: (row) => row.permissions.map((p) => p.code).join(", "), header: ({ column }) => <DataTableColumnHeader column={column} title="Permissions" />, cell: ({ row }) => <div className="flex gap-1 flex-wrap">{row.original.permissions.map((p) => <Badge key={p.id} variant="outline">{p.code}</Badge>)}</div> },
    { id: "actions", header: "Actions", cell: ({ row }) => <DataTableRowActions row={row.original} actions={rowActions} /> },
  ];

  if (isLoading) return <div className="p-6">Loading...</div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Roles</h1>
          <p className="text-sm text-muted-foreground">Manage roles and their permissions</p>
        </div>
        <Button onClick={openCreate}><Plus className="mr-2 h-4 w-4" />Add Role</Button>
      </div>
      <DataTable columns={columns} data={roles} searchKey="name" searchPlaceholder="Search by name..." />
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editing ? "Edit Role" : "Add Role"}</DialogTitle></DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit((v) => mutation.mutate(v))} noValidate className="space-y-4">
              <FormField control={form.control} name="name" render={({ field }) => (<FormItem><FormLabel>Name</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>)} />
              <FormField control={form.control} name="description" render={({ field }) => (<FormItem><FormLabel>Description</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>)} />
              <FormField control={form.control} name="permission_ids" render={({ field }) => (
                <FormItem>
                  <FormLabel>Permissions</FormLabel>
                  <div className="space-y-2 max-h-48 overflow-y-auto">
                    {permissions.map((perm) => (
                      <label key={perm.id} className="flex items-center gap-2 text-sm">
                        <Checkbox
                          checked={field.value.includes(perm.id)}
                          onCheckedChange={(checked) => {
                            field.onChange(checked ? [...field.value, perm.id] : field.value.filter((id: string) => id !== perm.id));
                          }}
                        />
                        {perm.code}
                      </label>
                    ))}
                  </div>
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
