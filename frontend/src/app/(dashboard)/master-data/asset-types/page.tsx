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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DataTable, DataTableColumnHeader, DataTableRowActions, type RowAction, type EditableColumn } from "@/components/data-table";
import { Form, FormField, FormItem, FormLabel, FormControl, FormMessage } from "@/components/form";

interface Service { id: string; name: string; code: string; }
interface AssetType { id: string; name: string; code: string; service_id: string; parent_type_id: string | null; sort_order: number; created_at: string; }

const schema = z.object({
  name: z.string().min(1, "Name is required"),
  code: z.string().min(1, "Code is required"),
  service_id: z.string().min(1, "Service is required"),
  parent_type_id: z.string(),
  sort_order: z.number().int().min(0),
});

type FormValues = z.infer<typeof schema>;

export default function AssetTypesPage() {
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<AssetType | null>(null);

  const { data: assetTypes = [], isLoading } = useQuery<AssetType[]>({
    queryKey: ["asset-types"],
    queryFn: async () => (await api.get("/asset-types")).data,
  });

  const { data: services = [] } = useQuery<Service[]>({
    queryKey: ["services"],
    queryFn: async () => (await api.get("/services")).data,
  });

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { name: "", code: "", service_id: "", parent_type_id: "", sort_order: 0 },
  });

  const mutation = useMutation({
    mutationFn: async (values: FormValues) => {
      const payload = { ...values, parent_type_id: values.parent_type_id || null };
      if (editing) return api.patch(`/asset-types/${editing.id}`, payload);
      return api.post("/asset-types", payload);
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["asset-types"] }); closeDialog(); },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/asset-types/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["asset-types"] }),
  });

  const inlineUpdate = async (row: AssetType, updates: Record<string, any>) => {
    const payload = { ...updates };
    if ("parent_type_id" in payload && !payload.parent_type_id) payload.parent_type_id = null;
    await api.patch(`/asset-types/${row.id}`, payload);
    queryClient.invalidateQueries({ queryKey: ["asset-types"] });
  };

  const editableCols: Record<string, EditableColumn> = {
    name: { type: "text" },
    code: { type: "text" },
    service_id: { type: "select", options: services.map((s) => ({ label: s.name, value: s.id })) },
    parent_type_id: { type: "select", options: [{ label: "None", value: "" }, ...assetTypes.map((t) => ({ label: t.name, value: t.id }))] },
    sort_order: { type: "number" },
  };

  const openCreate = () => { setEditing(null); form.reset({ name: "", code: "", service_id: "", parent_type_id: "", sort_order: 0 }); setDialogOpen(true); };
  const openEdit = (item: AssetType) => { setEditing(item); form.reset({ name: item.name, code: item.code, service_id: item.service_id, parent_type_id: item.parent_type_id || "", sort_order: item.sort_order }); setDialogOpen(true); };
  const closeDialog = () => { setDialogOpen(false); setEditing(null); };

  const rowActions: RowAction<AssetType>[] = [
    { label: "Edit", onClick: openEdit },
    { label: "Delete", onClick: (row) => deleteMutation.mutate(row.id), destructive: true, separator: true, confirm: "Are you sure you want to delete this asset type? This action cannot be undone." },
  ];

  const sorted = [...assetTypes].sort((a, b) => a.sort_order - b.sort_order);

  const columns: ColumnDef<AssetType, unknown>[] = [
    { accessorKey: "sort_order", header: ({ column }) => <DataTableColumnHeader column={column} title="Sort Order" />, meta: { title: "Sort Order", width: "170px" } },
    { accessorKey: "name", header: ({ column }) => <DataTableColumnHeader column={column} title="Name" /> },
    { accessorKey: "code", header: ({ column }) => <DataTableColumnHeader column={column} title="Code" /> },
    { accessorKey: "service_id", header: ({ column }) => <DataTableColumnHeader column={column} title="Service" />, meta: { title: "Service" }, cell: ({ row }) => services.find((s) => s.id === row.original.service_id)?.name ?? "-" },
    { accessorKey: "parent_type_id", header: ({ column }) => <DataTableColumnHeader column={column} title="Parent Type" />, meta: { title: "Parent Type" }, cell: ({ row }) => row.original.parent_type_id ? assetTypes.find((t) => t.id === row.original.parent_type_id)?.name ?? "-" : "-" },
    { id: "actions", header: "Actions", cell: ({ row }) => <DataTableRowActions row={row.original} actions={rowActions} /> },
  ];

  if (isLoading) return <div className="p-6">Loading...</div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Asset Types</h1>
          <p className="text-sm text-muted-foreground">Manage asset types and their sort order</p>
        </div>
        <Button onClick={openCreate}><Plus className="mr-2 h-4 w-4" />Add Asset Type</Button>
      </div>
      <DataTable columns={columns} data={sorted} searchKey="name" searchPlaceholder="Search by name..." editableColumns={editableCols} onRowUpdate={inlineUpdate} />
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{editing ? "Edit Asset Type" : "Add Asset Type"}</DialogTitle></DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit((v) => mutation.mutate(v))} noValidate className="space-y-4">
              <FormField control={form.control} name="name" render={({ field }) => (<FormItem><FormLabel>Name</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>)} />
              <FormField control={form.control} name="code" render={({ field }) => (<FormItem><FormLabel>Code</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>)} />
              <FormField control={form.control} name="service_id" render={({ field }) => (
                <FormItem><FormLabel>Service</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl><SelectTrigger><SelectValue placeholder="Select service">{field.value ? services.find((s) => s.id === field.value)?.name : ""}</SelectValue></SelectTrigger></FormControl>
                    <SelectContent>{services.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent>
                  </Select><FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="parent_type_id" render={({ field }) => (
                <FormItem><FormLabel>Parent Type (optional)</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl><SelectTrigger><SelectValue placeholder="None">{field.value ? assetTypes.find((t) => t.id === field.value)?.name : "None"}</SelectValue></SelectTrigger></FormControl>
                    <SelectContent>
                      <SelectItem value="">None</SelectItem>
                      {assetTypes.filter((t) => t.id !== editing?.id).map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
                    </SelectContent>
                  </Select><FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="sort_order" render={({ field }) => (<FormItem><FormLabel>Sort Order</FormLabel><FormControl><Input type="number" {...field} /></FormControl><FormMessage /></FormItem>)} />
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
