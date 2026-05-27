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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DataTable, DataTableColumnHeader, DataTableRowActions, type RowAction } from "@/components/data-table";
import { Form, FormField, FormItem, FormLabel, FormControl, FormMessage } from "@/components/form";
import { Checkbox } from "@/components/ui/checkbox";

interface Service { id: string; name: string; code: string; discipline_id: string; }
interface Activity { id: string; name: string; code: string; service_id: string; is_milestone: boolean; created_at: string; }

const schema = z.object({
  name: z.string().min(1, "Name is required"),
  code: z.string().min(1, "Code is required"),
  service_id: z.string().min(1, "Service is required"),
  is_milestone: z.boolean(),
});

type FormValues = z.infer<typeof schema>;

export default function ActivitiesPage() {
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Activity | null>(null);

  const { data: activities = [], isLoading } = useQuery<Activity[]>({
    queryKey: ["activities"],
    queryFn: async () => (await api.get("/activities")).data,
  });

  const { data: services = [] } = useQuery<Service[]>({
    queryKey: ["services"],
    queryFn: async () => (await api.get("/services")).data,
  });

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { name: "", code: "", service_id: "", is_milestone: false },
  });

  const mutation = useMutation({
    mutationFn: async (values: FormValues) => {
      if (editing) return api.patch(`/activities/${editing.id}`, values);
      return api.post("/activities", values);
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["activities"] }); closeDialog(); },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/activities/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["activities"] }),
  });

  const openCreate = () => { setEditing(null); form.reset({ name: "", code: "", service_id: "", is_milestone: false }); setDialogOpen(true); };
  const openEdit = (item: Activity) => { setEditing(item); form.reset({ name: item.name, code: item.code, service_id: item.service_id, is_milestone: item.is_milestone }); setDialogOpen(true); };
  const closeDialog = () => { setDialogOpen(false); setEditing(null); };

  const rowActions: RowAction<Activity>[] = [
    { label: "Edit", onClick: openEdit },
    { label: "Delete", onClick: (row) => deleteMutation.mutate(row.id), destructive: true, separator: true, confirm: "Are you sure you want to delete this item? This action cannot be undone." },
  ];

  const columns: ColumnDef<Activity, unknown>[] = [
    { accessorKey: "code", header: ({ column }) => <DataTableColumnHeader column={column} title="Code" /> },
    { accessorKey: "name", header: ({ column }) => <DataTableColumnHeader column={column} title="Name" /> },
    { id: "service", accessorFn: (row) => services.find((s) => s.id === row.service_id)?.name ?? "—", header: ({ column }) => <DataTableColumnHeader column={column} title="Service" /> },
    { accessorKey: "is_milestone", header: ({ column }) => <DataTableColumnHeader column={column} title="Milestone" />, cell: ({ row }) => row.getValue("is_milestone") ? "Yes" : "No", meta: { title: "Milestone" } },
    { id: "actions", header: "Actions", cell: ({ row }) => <DataTableRowActions row={row.original} actions={rowActions} /> },
  ];

  if (isLoading) return <div className="p-6">Loading...</div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Activities</h1>
          <p className="text-sm text-muted-foreground">Manage activities</p>
        </div>
        <Button onClick={openCreate}><Plus className="mr-2 h-4 w-4" />Add Activity</Button>
      </div>
      <DataTable
        columns={columns}
        data={activities}
        searchKey="name"
        searchPlaceholder="Search by name..."
        onExport={(rows) => exportToCsv(rows, "activities")}
        onImport={async (file) => {
          const rows = await parseCsv(file);
          await Promise.allSettled(rows.map((row) => api.post("/activities", row)));
          queryClient.invalidateQueries({ queryKey: ["activities"] });
        }}
        onDownloadTemplate={() => downloadTemplate(["name", "code", "service_id", "is_milestone"], "activities")}
        onBulkDelete={async (rows) => {
          await Promise.allSettled(rows.map((row) => api.delete(`/activities/${row.id}`)));
          queryClient.invalidateQueries({ queryKey: ["activities"] });
        }}
      />
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editing ? "Edit Activity" : "Add Activity"}</DialogTitle></DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit((v) => mutation.mutate(v))} noValidate className="space-y-4">
              <FormField control={form.control} name="name" render={({ field }) => (<FormItem><FormLabel>Name</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>)} />
              <FormField control={form.control} name="code" render={({ field }) => (<FormItem><FormLabel>Code</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>)} />
              <FormField control={form.control} name="service_id" render={({ field }) => (
                <FormItem><FormLabel>Service</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl><SelectTrigger><SelectValue placeholder="Select service" /></SelectTrigger></FormControl>
                    <SelectContent>{services.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent>
                  </Select><FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="is_milestone" render={({ field }) => (
                <FormItem className="flex flex-row items-center gap-2 space-y-0">
                  <FormControl><Checkbox checked={field.value} onCheckedChange={field.onChange} /></FormControl>
                  <FormLabel>Is Milestone</FormLabel>
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
