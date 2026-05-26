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

interface Role { id: string; name: string; description: string | null; }
interface UserItem { id: string; email: string; full_name: string; is_active: boolean; is_superuser: boolean; roles: Role[]; }

const schema = z.object({
  email: z.string().min(1, "Email is required").email("Invalid email"),
  full_name: z.string().min(1, "Name is required"),
  password: z.string(),
  is_active: z.boolean(),
  is_superuser: z.boolean(),
  role_ids: z.array(z.string()),
});

const resetSchema = z.object({
  password: z.string().min(1, "Password is required"),
});

type FormValues = z.infer<typeof schema>;
type ResetFormValues = z.infer<typeof resetSchema>;

export default function UsersPage() {
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [resetDialogOpen, setResetDialogOpen] = useState(false);
  const [editing, setEditing] = useState<UserItem | null>(null);
  const [resettingUser, setResettingUser] = useState<UserItem | null>(null);

  const { data: users = [], isLoading } = useQuery<UserItem[]>({
    queryKey: ["admin-users"],
    queryFn: async () => (await api.get("/admin/users")).data,
  });

  const { data: roles = [] } = useQuery<Role[]>({
    queryKey: ["admin-roles"],
    queryFn: async () => (await api.get("/admin/roles")).data,
  });

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { email: "", full_name: "", password: "", is_active: true, is_superuser: false, role_ids: [] },
  });

  const resetForm = useForm<ResetFormValues>({
    resolver: zodResolver(resetSchema),
    defaultValues: { password: "" },
  });

  const mutation = useMutation({
    mutationFn: async (values: FormValues) => {
      const payload: Record<string, unknown> = { ...values };
      if (editing) {
        delete payload.password;
        return api.patch(`/admin/users/${editing.id}`, payload);
      }
      return api.post("/admin/users", payload);
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["admin-users"] }); closeDialog(); },
  });

  const resetMutation = useMutation({
    mutationFn: async (values: ResetFormValues) => {
      return api.patch(`/admin/users/${resettingUser!.id}`, { password: values.password });
    },
    onSuccess: () => { setResetDialogOpen(false); setResettingUser(null); },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/admin/users/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["admin-users"] }),
  });

  const openCreate = () => { setEditing(null); form.reset({ email: "", full_name: "", password: "", is_active: true, is_superuser: false, role_ids: [] }); setDialogOpen(true); };
  const openEdit = (item: UserItem) => { setEditing(item); form.reset({ email: item.email, full_name: item.full_name, password: "", is_active: item.is_active, is_superuser: item.is_superuser, role_ids: item.roles.map((r) => r.id) }); setDialogOpen(true); };
  const openReset = (item: UserItem) => { setResettingUser(item); resetForm.reset({ password: "" }); setResetDialogOpen(true); };
  const closeDialog = () => { setDialogOpen(false); setEditing(null); };

  const rowActions: RowAction<UserItem>[] = [
    { label: "Edit", onClick: openEdit },
    { label: "Reset Password", onClick: openReset },
    { label: "Delete", onClick: (row) => deleteMutation.mutate(row.id), destructive: true, separator: true, confirm: "Are you sure you want to delete this item? This action cannot be undone." },
  ];

  const columns: ColumnDef<UserItem, unknown>[] = [
    { accessorKey: "full_name", header: ({ column }) => <DataTableColumnHeader column={column} title="Name" /> },
    { accessorKey: "email", header: ({ column }) => <DataTableColumnHeader column={column} title="Email" /> },
    { id: "roles", accessorFn: (row) => row.roles.map((r) => r.name).join(", "), header: ({ column }) => <DataTableColumnHeader column={column} title="Roles" />, cell: ({ row }) => <div className="flex gap-1 flex-wrap">{row.original.roles.map((r) => <Badge key={r.id} variant="secondary">{r.name}</Badge>)}</div> },
    { accessorKey: "is_active", header: ({ column }) => <DataTableColumnHeader column={column} title="Active" />, cell: ({ row }) => row.getValue("is_active") ? "Yes" : "No" },
    { id: "actions", header: "Actions", cell: ({ row }) => <DataTableRowActions row={row.original} actions={rowActions} /> },
  ];

  if (isLoading) return <div className="p-6">Loading...</div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Users</h1>
          <p className="text-sm text-muted-foreground">Manage system users</p>
        </div>
        <Button onClick={openCreate}><Plus className="mr-2 h-4 w-4" />Add User</Button>
      </div>
      <DataTable columns={columns} data={users} searchKey="full_name" searchPlaceholder="Search by name..." />

      {/* Create/Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editing ? "Edit User" : "Add User"}</DialogTitle></DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit((v) => mutation.mutate(v))} noValidate className="space-y-4">
              <FormField control={form.control} name="full_name" render={({ field }) => (<FormItem><FormLabel>Full Name</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>)} />
              <FormField control={form.control} name="email" render={({ field }) => (<FormItem><FormLabel>Email</FormLabel><FormControl><Input type="email" {...field} /></FormControl><FormMessage /></FormItem>)} />
              {!editing && <FormField control={form.control} name="password" render={({ field }) => (<FormItem><FormLabel>Password</FormLabel><FormControl><Input type="password" {...field} /></FormControl><FormMessage /></FormItem>)} />}
              <FormField control={form.control} name="is_active" render={({ field }) => (
                <FormItem className="flex flex-row items-center gap-2 space-y-0">
                  <FormControl><Checkbox checked={field.value} onCheckedChange={field.onChange} /></FormControl>
                  <FormLabel>Active</FormLabel>
                </FormItem>
              )} />
              <FormField control={form.control} name="is_superuser" render={({ field }) => (
                <FormItem className="flex flex-row items-center gap-2 space-y-0">
                  <FormControl><Checkbox checked={field.value} onCheckedChange={field.onChange} /></FormControl>
                  <FormLabel>Superuser</FormLabel>
                </FormItem>
              )} />
              <FormField control={form.control} name="role_ids" render={({ field }) => (
                <FormItem>
                  <FormLabel>Roles</FormLabel>
                  <div className="space-y-2">
                    {roles.map((role) => (
                      <label key={role.id} className="flex items-center gap-2 text-sm">
                        <Checkbox
                          checked={field.value.includes(role.id)}
                          onCheckedChange={(checked) => {
                            field.onChange(checked ? [...field.value, role.id] : field.value.filter((id: string) => id !== role.id));
                          }}
                        />
                        {role.name}
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

      {/* Reset Password Dialog */}
      <Dialog open={resetDialogOpen} onOpenChange={setResetDialogOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Reset Password</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">Set a temporary password for <span className="font-medium text-foreground">{resettingUser?.full_name}</span>. They will be required to change it on next login. The temporary password expires in 1 hour.</p>
          <Form {...resetForm}>
            <form onSubmit={resetForm.handleSubmit((v) => resetMutation.mutate(v))} noValidate className="space-y-4">
              <FormField control={resetForm.control} name="password" render={({ field }) => (<FormItem><FormLabel>Temporary Password</FormLabel><FormControl><Input type="password" {...field} /></FormControl><FormMessage /></FormItem>)} />
              {resetMutation.isSuccess && <p className="text-sm text-green-600">Password reset successfully</p>}
              <div className="flex justify-end gap-2 pt-2">
                <Button type="button" variant="outline" onClick={() => setResetDialogOpen(false)}>Cancel</Button>
                <Button type="submit" disabled={resetMutation.isPending}>{resetMutation.isPending ? "Resetting..." : "Reset Password"}</Button>
              </div>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
