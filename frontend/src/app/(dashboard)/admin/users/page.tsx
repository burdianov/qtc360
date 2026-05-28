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
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DataTable, DataTableColumnHeader, DataTableRowActions, type RowAction } from "@/components/data-table";
import { Form, FormField, FormItem, FormLabel, FormControl, FormMessage } from "@/components/form";
import { Badge } from "@/components/ui/badge";

interface Role { id: string; name: string; description: string | null; }
interface Designation { id: string; name: string; }
interface UserItem { id: string; email: string; full_name: string; designation_id: string | null; designation: Designation | null; is_active: boolean; is_superuser: boolean; roles: Role[]; }

const passwordPolicy = z
  .string()
  .min(8, "At least 8 characters")
  .regex(/[A-Z]/, "Must contain an uppercase letter")
  .regex(/\d/, "Must contain a digit");

const schema = z.object({
  email: z.string().min(1, "Email is required").email("Invalid email"),
  full_name: z.string().min(1, "Name is required"),
  designation_id: z.string().optional(),
  // On create the password is required + policy-validated. On edit the field is left
  // blank (handled at submit time below).
  password: z.string(),
  is_active: z.boolean(),
  role_ids: z.array(z.string()),
});

const resetSchema = z.object({
  password: passwordPolicy,
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

  const { data: designations = [] } = useQuery<Designation[]>({
    queryKey: ["designations"],
    queryFn: async () => (await api.get("/designations")).data,
  });

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { email: "", full_name: "", designation_id: "", password: "", is_active: true, role_ids: [] },
  });

  const resetForm = useForm<ResetFormValues>({
    resolver: zodResolver(resetSchema),
    defaultValues: { password: "" },
  });

  const mutation = useMutation({
    mutationFn: async (values: FormValues) => {
      const payload: Record<string, unknown> = { ...values };
      if (!payload.designation_id) payload.designation_id = null;
      if (editing) {
        delete payload.password;
        return api.patch(`/admin/users/${editing.id}`, payload);
      }
      // Enforce policy at submit time so editing-without-password isn't blocked.
      const pw = passwordPolicy.safeParse(values.password);
      if (!pw.success) {
        const msg = pw.error.issues[0]?.message || "Password does not meet policy";
        throw Object.assign(new Error(msg), { response: { data: { detail: msg } } });
      }
      return api.post("/admin/users", payload);
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["admin-users"] }); closeDialog(); },
    onError: (e: any) => {
      const detail = e.response?.data?.detail;
      const status = e.response?.status;
      toast.error(detail || `Failed to save user (${status || 'network error'})`);
      if (process.env.NODE_ENV !== "production") {
        console.error("User save error:", e.response?.status, e.response?.data);
      }
    },
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

  const openCreate = () => { setEditing(null); form.reset({ email: "", full_name: "", designation_id: "", password: "", is_active: true, role_ids: [] }); setDialogOpen(true); };
  const openEdit = (item: UserItem) => { setEditing(item); form.reset({ email: item.email, full_name: item.full_name, designation_id: item.designation_id || "", password: "", is_active: item.is_active, role_ids: item.roles.map((r) => r.id) }); setDialogOpen(true); };
  const openReset = (item: UserItem) => { setResettingUser(item); resetForm.reset({ password: "" }); setResetDialogOpen(true); };
  const closeDialog = () => { setDialogOpen(false); setEditing(null); };

  const rowActions: RowAction<UserItem>[] = [
    { label: "Edit", onClick: openEdit },
    { label: "Reset Password", onClick: openReset },
    { label: "Delete", onClick: (row) => deleteMutation.mutate(row.id), destructive: true, separator: true, confirm: "Are you sure you want to delete this item? This action cannot be undone." },
  ];

  const columns: ColumnDef<UserItem, unknown>[] = [
    { accessorKey: "full_name", header: ({ column }) => <DataTableColumnHeader column={column} title="Name" />, meta: { title: "Name" } },
    { accessorKey: "email", header: ({ column }) => <DataTableColumnHeader column={column} title="Email" /> },
    { accessorKey: "designation", header: ({ column }) => <DataTableColumnHeader column={column} title="Designation" />, accessorFn: (row) => row.designation?.name || "—", meta: { title: "Designation" } },
    { id: "roles", accessorFn: (row) => row.roles.map((r) => r.name).join(", "), header: ({ column }) => <DataTableColumnHeader column={column} title="Role" />, cell: ({ row }) => <div className="flex gap-1 flex-wrap">{row.original.roles.map((r) => <Badge key={r.id} variant="secondary">{r.name}</Badge>)}</div>, meta: { title: "Role" } },
    { accessorKey: "is_active", header: ({ column }) => <DataTableColumnHeader column={column} title="Active" />, cell: ({ row }) => row.getValue("is_active") ? "Yes" : "No", meta: { title: "Active" } },
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
      <DataTable
        columns={columns}
        data={users}
        searchKey="full_name"
        searchPlaceholder="Search by name..."
        onExport={(rows) => exportToCsv(rows.map(({ id, email, full_name, designation, is_active, is_superuser, roles }) => ({ email, full_name, designation: designation?.name || "", is_active, is_superuser, roles: roles.map((r) => r.name).join(";") })), "users")}
        onImport={async (file) => {
          const rows = await parseCsv(file);
          await Promise.allSettled(rows.map((row) => {
            const roleNames = (row.role || "").split(";").map((r: string) => r.trim().toLowerCase()).filter(Boolean);
            const matchedRoleIds = roles.filter((r) => roleNames.includes(r.name.toLowerCase())).map((r) => r.id);
            const matchedDesignation = designations.find((d) => d.name.toLowerCase() === (row.designation || "").trim().toLowerCase());
            return api.post("/admin/users", { email: row.email, full_name: row.full_name, designation_id: matchedDesignation?.id || null, password: row.password || "Temp1234", is_active: true, is_superuser: false, role_ids: matchedRoleIds });
          }));
          queryClient.invalidateQueries({ queryKey: ["admin-users"] });
        }}
        onDownloadTemplate={() => downloadTemplate(["email", "full_name", "designation", "password", "role"], "users")}
      />

      {/* Create/Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editing ? "Edit User" : "Add User"}</DialogTitle></DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit((v) => mutation.mutate(v))} noValidate className="space-y-4">
              <FormField control={form.control} name="full_name" render={({ field }) => (<FormItem><FormLabel>Full Name</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>)} />
              <FormField control={form.control} name="designation_id" render={({ field }) => (
                <FormItem>
                  <FormLabel>Designation</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value || undefined}>
                    <FormControl><SelectTrigger><SelectValue placeholder="Select designation">{field.value ? designations.find((d) => d.id === field.value)?.name : ""}</SelectValue></SelectTrigger></FormControl>
                    <SelectContent>{designations.map((d) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}</SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="email" render={({ field }) => (<FormItem><FormLabel>Email</FormLabel><FormControl><Input type="email" {...field} /></FormControl><FormMessage /></FormItem>)} />
              {!editing && <FormField control={form.control} name="password" render={({ field }) => (<FormItem><FormLabel>Password</FormLabel><FormControl><Input type="password" {...field} /></FormControl><FormMessage /></FormItem>)} />}
              <FormField control={form.control} name="is_active" render={({ field }) => (
                <FormItem className="flex flex-row items-center gap-2 space-y-0">
                  <FormControl><Checkbox checked={field.value} onCheckedChange={field.onChange} /></FormControl>
                  <FormLabel>Active</FormLabel>
                </FormItem>
              )} />
              <FormField control={form.control} name="role_ids" render={({ field }) => (
                <FormItem>
                  <FormLabel>Roles</FormLabel>
                  <div className="space-y-2">
                    {roles.filter((role) => role.name !== "super_admin").map((role) => (
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
