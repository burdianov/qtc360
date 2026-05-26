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

interface Employee { id: string; name: string; email: string | null; phone: string | null; position: string | null; project_id: string; created_at: string; }

const schema = z.object({
  name: z.string().min(1, "Name is required"),
  email: z.string(),
  phone: z.string(),
  position: z.string(),
});

type FormValues = z.infer<typeof schema>;

export default function EmployeesPage() {
  const queryClient = useQueryClient();
  const selectedProject = useSelectedProject();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Employee | null>(null);

  const { data: allEmployees = [], isLoading } = useQuery<Employee[]>({
    queryKey: ["employees"],
    queryFn: async () => (await api.get("/employees")).data,
  });

  const employees = allEmployees.filter((e) => e.project_id === selectedProject?.id);

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { name: "", email: "", phone: "", position: "" },
  });

  const mutation = useMutation({
    mutationFn: async (values: FormValues) => {
      const payload = { ...values, email: values.email || null, phone: values.phone || null, position: values.position || null, project_id: selectedProject?.id };
      if (editing) return api.patch(`/employees/${editing.id}`, payload);
      return api.post("/employees", payload);
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["employees"] }); closeDialog(); },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/employees/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["employees"] }),
  });

  const openCreate = () => { setEditing(null); form.reset({ name: "", email: "", phone: "", position: "" }); setDialogOpen(true); };
  const openEdit = (item: Employee) => { setEditing(item); form.reset({ name: item.name, email: item.email || "", phone: item.phone || "", position: item.position || "" }); setDialogOpen(true); };
  const closeDialog = () => { setDialogOpen(false); setEditing(null); };

  const rowActions: RowAction<Employee>[] = [
    { label: "Edit", onClick: openEdit },
    { label: "Delete", onClick: (row) => deleteMutation.mutate(row.id), destructive: true, separator: true },
  ];

  const columns: ColumnDef<Employee, unknown>[] = [
    { accessorKey: "name", header: ({ column }) => <DataTableColumnHeader column={column} title="Name" /> },
    { accessorKey: "email", header: ({ column }) => <DataTableColumnHeader column={column} title="Email" />, cell: ({ row }) => row.getValue("email") || "—" },
    { accessorKey: "phone", header: ({ column }) => <DataTableColumnHeader column={column} title="Phone" />, cell: ({ row }) => row.getValue("phone") || "—" },
    { accessorKey: "position", header: ({ column }) => <DataTableColumnHeader column={column} title="Position" />, cell: ({ row }) => row.getValue("position") || "—" },
    { id: "actions", header: "Actions", cell: ({ row }) => <DataTableRowActions row={row.original} actions={rowActions} /> },
  ];

  if (isLoading) return <div className="p-6">Loading...</div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Employees</h1>
          <p className="text-sm text-muted-foreground">Manage employees for the current project</p>
        </div>
        <Button onClick={openCreate}><Plus className="mr-2 h-4 w-4" />Add Employee</Button>
      </div>
      <DataTable
        columns={columns}
        data={employees}
        searchKey="name"
        searchPlaceholder="Search by name..."
        onExport={(rows) => exportToCsv(rows, "employees")}
        onImport={async (file) => {
          const rows = await parseCsv(file);
          for (const row of rows) await api.post("/employees", { ...row, project_id: selectedProject?.id });
          queryClient.invalidateQueries({ queryKey: ["employees"] });
        }}
        onDownloadTemplate={() => downloadTemplate(["name", "email", "phone", "position"], "employees")}
        onBulkDelete={async (rows) => {
          for (const row of rows) await api.delete(`/employees/${row.id}`);
          queryClient.invalidateQueries({ queryKey: ["employees"] });
        }}
      />
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editing ? "Edit Employee" : "Add Employee"}</DialogTitle></DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit((v) => mutation.mutate(v))} noValidate className="space-y-4">
              <FormField control={form.control} name="name" render={({ field }) => (<FormItem><FormLabel>Name</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>)} />
              <FormField control={form.control} name="email" render={({ field }) => (<FormItem><FormLabel>Email</FormLabel><FormControl><Input type="email" {...field} /></FormControl><FormMessage /></FormItem>)} />
              <FormField control={form.control} name="phone" render={({ field }) => (<FormItem><FormLabel>Phone</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>)} />
              <FormField control={form.control} name="position" render={({ field }) => (<FormItem><FormLabel>Position</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>)} />
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
