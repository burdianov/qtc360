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

interface Activity { id: string; name: string; code: string; }
interface SubActivity { id: string; name: string; code: string; activity_id: string; created_at: string; }

const schema = z.object({
  name: z.string().min(1, "Name is required"),
  code: z.string().min(1, "Code is required"),
  activity_id: z.string().min(1, "Activity is required"),
});

type FormValues = z.infer<typeof schema>;

export default function SubActivitiesPage() {
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<SubActivity | null>(null);

  const { data: subActivities = [], isLoading } = useQuery<SubActivity[]>({
    queryKey: ["sub-activities"],
    queryFn: async () => (await api.get("/sub-activities")).data,
  });

  const { data: activities = [] } = useQuery<Activity[]>({
    queryKey: ["activities"],
    queryFn: async () => (await api.get("/activities")).data,
  });

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { name: "", code: "", activity_id: "" },
  });

  const mutation = useMutation({
    mutationFn: async (values: FormValues) => {
      if (editing) return api.patch(`/sub-activities/${editing.id}`, values);
      return api.post("/sub-activities", values);
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["sub-activities"] }); closeDialog(); },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/sub-activities/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["sub-activities"] }),
  });

  const openCreate = () => { setEditing(null); form.reset({ name: "", code: "", activity_id: "" }); setDialogOpen(true); };
  const openEdit = (item: SubActivity) => { setEditing(item); form.reset({ name: item.name, code: item.code, activity_id: item.activity_id }); setDialogOpen(true); };
  const closeDialog = () => { setDialogOpen(false); setEditing(null); };

  const rowActions: RowAction<SubActivity>[] = [
    { label: "Edit", onClick: openEdit },
    { label: "Delete", onClick: (row) => deleteMutation.mutate(row.id), destructive: true, separator: true, confirm: "Are you sure you want to delete this item? This action cannot be undone." },
  ];

  const columns: ColumnDef<SubActivity, unknown>[] = [
    { accessorKey: "code", header: ({ column }) => <DataTableColumnHeader column={column} title="Code" /> },
    { accessorKey: "name", header: ({ column }) => <DataTableColumnHeader column={column} title="Name" /> },
    { id: "activity", accessorFn: (row) => activities.find((a) => a.id === row.activity_id)?.name ?? "—", header: ({ column }) => <DataTableColumnHeader column={column} title="Activity" /> },
    { id: "actions", header: "Actions", cell: ({ row }) => <DataTableRowActions row={row.original} actions={rowActions} /> },
  ];

  if (isLoading) return <div className="p-6">Loading...</div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Sub-Activities</h1>
          <p className="text-sm text-muted-foreground">Manage sub-activities</p>
        </div>
        <Button onClick={openCreate}><Plus className="mr-2 h-4 w-4" />Add Sub-Activity</Button>
      </div>
      <DataTable
        columns={columns}
        data={subActivities}
        searchKey="name"
        searchPlaceholder="Search by name..."
        onExport={(rows) => exportToCsv(rows, "sub-activities")}
        onImport={async (file) => {
          const rows = await parseCsv(file);
          await Promise.allSettled(rows.map((row) => api.post("/sub-activities", row)));
          queryClient.invalidateQueries({ queryKey: ["sub-activities"] });
        }}
        onDownloadTemplate={() => downloadTemplate(["name", "code", "activity_id"], "sub-activities")}
        onBulkDelete={async (rows) => {
          await Promise.allSettled(rows.map((row) => api.delete(`/sub-activities/${row.id}`)));
          queryClient.invalidateQueries({ queryKey: ["sub-activities"] });
        }}
      />
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editing ? "Edit Sub-Activity" : "Add Sub-Activity"}</DialogTitle></DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit((v) => mutation.mutate(v))} noValidate className="space-y-4">
              <FormField control={form.control} name="name" render={({ field }) => (<FormItem><FormLabel>Name</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>)} />
              <FormField control={form.control} name="code" render={({ field }) => (<FormItem><FormLabel>Code</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>)} />
              <FormField control={form.control} name="activity_id" render={({ field }) => (
                <FormItem><FormLabel>Activity</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl><SelectTrigger><SelectValue placeholder="Select activity" /></SelectTrigger></FormControl>
                    <SelectContent>{activities.map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}</SelectContent>
                  </Select><FormMessage />
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
