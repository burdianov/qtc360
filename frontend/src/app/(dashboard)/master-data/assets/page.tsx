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
import { useSelectedProject } from "@/hooks/use-project";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DataTable, DataTableColumnHeader, DataTableRowActions, type RowAction } from "@/components/data-table";
import { Form, FormField, FormItem, FormLabel, FormControl, FormMessage } from "@/components/form";

interface AssetType { id: string; name: string; code: string; }
interface Asset { id: string; name: string; tag_number: string; asset_type_id: string; location: string | null; status: string; created_at: string; }

const schema = z.object({
  name: z.string().min(1, "Name is required"),
  tag_number: z.string().min(1, "Tag number is required"),
  asset_type_id: z.string().min(1, "Asset type is required"),
  location: z.string(),
  status: z.string(),
});

type FormValues = z.infer<typeof schema>;

export default function AssetsPage() {
  const queryClient = useQueryClient();
  const project = useSelectedProject();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Asset | null>(null);
  const [filterTypeId, setFilterTypeId] = useState<string>("");

  const { data: assets = [], isLoading } = useQuery<Asset[]>({
    queryKey: ["assets", project?.id],
    queryFn: async () => (await api.get("/assets", { params: { project_id: project?.id } })).data,
    enabled: !!project?.id,
  });

  const { data: assetTypes = [] } = useQuery<AssetType[]>({
    queryKey: ["asset-types"],
    queryFn: async () => (await api.get("/asset-types")).data,
  });

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { name: "", tag_number: "", asset_type_id: "", location: "", status: "pending" },
  });

  const mutation = useMutation({
    mutationFn: async (values: FormValues) => {
      const payload = { ...values, location: values.location || null };
      if (editing) return api.patch(`/assets/${editing.id}`, payload);
      return api.post("/assets", payload);
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["assets"] }); closeDialog(); },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/assets/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["assets"] }),
  });

  const openCreate = () => { setEditing(null); form.reset({ name: "", tag_number: "", asset_type_id: "", location: "", status: "pending" }); setDialogOpen(true); };
  const openEdit = (item: Asset) => { setEditing(item); form.reset({ name: item.name, tag_number: item.tag_number, asset_type_id: item.asset_type_id, location: item.location || "", status: item.status }); setDialogOpen(true); };
  const closeDialog = () => { setDialogOpen(false); setEditing(null); };

  const rowActions: RowAction<Asset>[] = [
    { label: "Edit", onClick: openEdit },
    { label: "Delete", onClick: (row) => deleteMutation.mutate(row.id), destructive: true, separator: true, confirm: "Are you sure you want to delete this item? This action cannot be undone." },
  ];

  const columns: ColumnDef<Asset, unknown>[] = [
    { accessorKey: "tag_number", header: ({ column }) => <DataTableColumnHeader column={column} title="Tag" />, meta: { title: "Tag" } },
    { accessorKey: "name", header: ({ column }) => <DataTableColumnHeader column={column} title="Name" /> },
    { id: "type", accessorFn: (row) => assetTypes.find((t) => t.id === row.asset_type_id)?.name ?? "—", header: ({ column }) => <DataTableColumnHeader column={column} title="Type" /> },
    { accessorKey: "status", header: ({ column }) => <DataTableColumnHeader column={column} title="Status" />, cell: ({ row }) => <span className="capitalize">{row.getValue("status")}</span> },
    { accessorKey: "location", header: ({ column }) => <DataTableColumnHeader column={column} title="Location" />, cell: ({ row }) => row.getValue("location") || "—" },
    { id: "actions", header: "Actions", cell: ({ row }) => <DataTableRowActions row={row.original} actions={rowActions} /> },
  ];

  if (isLoading) return <div className="p-6">Loading...</div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Assets</h1>
          <p className="text-sm text-muted-foreground">Manage assets</p>
        </div>
        <Button onClick={openCreate}><Plus className="mr-2 h-4 w-4" />Add Asset</Button>
      </div>
      <div className="flex gap-3 items-center">
        <Select value={filterTypeId} onValueChange={(v: any) => setFilterTypeId(v === "__all__" ? "" : v)}>
          <SelectTrigger className="w-56"><SelectValue placeholder="Filter by type">{filterTypeId ? assetTypes.find((t) => t.id === filterTypeId)?.name : "All Types"}</SelectValue></SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">All Types</SelectItem>
            {assetTypes.map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
          </SelectContent>
        </Select>
        {filterTypeId && <span className="text-xs text-muted-foreground">{assets.filter((a) => a.asset_type_id === filterTypeId).length} assets</span>}
      </div>
      <DataTable
        columns={columns}
        data={filterTypeId ? assets.filter((a) => a.asset_type_id === filterTypeId) : assets}
        searchKey="name"
        searchPlaceholder="Search by name..."
        onExport={(rows) => exportToCsv(rows, "assets")}
        onImport={async (file) => {
          const rows = await parseCsv(file);
          await Promise.allSettled(rows.map((row) => api.post("/assets", row)));
          queryClient.invalidateQueries({ queryKey: ["assets"] });
        }}
        onDownloadTemplate={() => downloadTemplate(["name", "tag_number", "asset_type_id", "location", "status"], "assets")}
        onBulkDelete={async (rows) => {
          await Promise.allSettled(rows.map((row) => api.delete(`/assets/${row.id}`)));
          queryClient.invalidateQueries({ queryKey: ["assets"] });
        }}
      />
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editing ? "Edit Asset" : "Add Asset"}</DialogTitle></DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit((v) => mutation.mutate(v))} noValidate className="space-y-4">
              <FormField control={form.control} name="name" render={({ field }) => (<FormItem><FormLabel>Name</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>)} />
              <FormField control={form.control} name="tag_number" render={({ field }) => (<FormItem><FormLabel>Tag Number</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>)} />
              <FormField control={form.control} name="asset_type_id" render={({ field }) => (
                <FormItem><FormLabel>Asset Type</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl><SelectTrigger><SelectValue placeholder="Select type">{field.value ? assetTypes.find((t) => t.id === field.value)?.name : ""}</SelectValue></SelectTrigger></FormControl>
                    <SelectContent>{assetTypes.map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}</SelectContent>
                  </Select><FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="location" render={({ field }) => (<FormItem><FormLabel>Location</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>)} />
              <FormField control={form.control} name="status" render={({ field }) => (
                <FormItem><FormLabel>Status</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                    <SelectContent>
                      <SelectItem value="pending">Pending</SelectItem>
                      <SelectItem value="installed">Installed</SelectItem>
                      <SelectItem value="commissioned">Commissioned</SelectItem>
                    </SelectContent>
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
