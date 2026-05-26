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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DataTable, DataTableColumnHeader, DataTableRowActions, type RowAction } from "@/components/data-table";
import { Form, FormField, FormItem, FormLabel, FormControl, FormMessage } from "@/components/form";
import { Badge } from "@/components/ui/badge";

interface AssetType { id: string; name: string; code: string; }
interface FAT {
  id: string;
  reference: string;
  title: string;
  asset_type_id: string;
  status: string;
  created_at: string;
}

const schema = z.object({
  reference: z.string().min(1, "Reference is required"),
  title: z.string().min(1, "Title is required"),
  asset_type_id: z.string().min(1, "Asset type is required"),
});

type FormValues = z.infer<typeof schema>;

const statusColors: Record<string, string> = {
  pending: "bg-amber-500/15 text-amber-500",
  approved: "bg-emerald-500/15 text-emerald-500",
};

export default function FATReportsPage() {
  const project = useSelectedProject();
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<FAT | null>(null);

  const { data: fats = [], isLoading } = useQuery<FAT[]>({
    queryKey: ["fats", project?.id],
    queryFn: async () => (await api.get("/fats", { params: { project_id: project!.id } })).data,
    enabled: !!project,
  });

  const { data: assetTypes = [] } = useQuery<AssetType[]>({
    queryKey: ["asset-types"],
    queryFn: async () => (await api.get("/asset-types")).data,
  });

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { reference: "", title: "", asset_type_id: "" },
  });

  const mutation = useMutation({
    mutationFn: async (values: FormValues) => {
      if (editing) return api.patch(`/fats/${editing.id}`, values);
      return api.post("/fats", { ...values, project_id: project!.id });
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["fats", project?.id] }); closeDialog(); },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/fats/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["fats", project?.id] }),
  });

  const openCreate = () => { setEditing(null); form.reset({ reference: "", title: "", asset_type_id: "" }); setDialogOpen(true); };
  const openEdit = (item: FAT) => { setEditing(item); form.reset({ reference: item.reference, title: item.title, asset_type_id: item.asset_type_id }); setDialogOpen(true); };
  const closeDialog = () => { setDialogOpen(false); setEditing(null); };

  const rowActions: RowAction<FAT>[] = [
    { label: "Edit", onClick: openEdit },
    { label: "Delete", onClick: (row) => deleteMutation.mutate(row.id), destructive: true, separator: true, confirm: "Are you sure you want to delete this item? This action cannot be undone." },
  ];

  const columns: ColumnDef<FAT, unknown>[] = [
    { accessorKey: "reference", header: ({ column }) => <DataTableColumnHeader column={column} title="Reference" /> },
    { accessorKey: "title", header: ({ column }) => <DataTableColumnHeader column={column} title="Title" /> },
    { accessorKey: "status", header: ({ column }) => <DataTableColumnHeader column={column} title="Status" />, cell: ({ row }) => <Badge className={statusColors[row.original.status] || ""}>{row.original.status}</Badge> },
    { id: "actions", header: "Actions", cell: ({ row }) => <DataTableRowActions row={row.original} actions={rowActions} /> },
  ];

  if (isLoading) return <div className="p-6">Loading...</div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">FAT Reports</h1>
          <p className="text-sm text-muted-foreground">Factory Acceptance Test records</p>
        </div>
        <Button onClick={openCreate}><Plus className="mr-2 h-4 w-4" />New FAT</Button>
      </div>
      <DataTable columns={columns} data={fats} searchKey="title" searchPlaceholder="Search by title..." />
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editing ? "Edit FAT" : "New FAT"}</DialogTitle></DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit((v) => mutation.mutate(v))} noValidate className="space-y-4">
              <FormField control={form.control} name="reference" render={({ field }) => (<FormItem><FormLabel>Reference</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>)} />
              <FormField control={form.control} name="title" render={({ field }) => (<FormItem><FormLabel>Title</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>)} />
              <FormField control={form.control} name="asset_type_id" render={({ field }) => (
                <FormItem>
                  <FormLabel>Asset Type</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl><SelectTrigger><SelectValue placeholder="Select asset type" /></SelectTrigger></FormControl>
                    <SelectContent>
                      {assetTypes.map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <FormMessage />
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
