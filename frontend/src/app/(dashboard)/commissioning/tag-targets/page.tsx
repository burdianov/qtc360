"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { z } from "zod/v4";
import { zodResolver } from "@hookform/resolvers/zod";
import { type ColumnDef } from "@tanstack/react-table";
import { Plus } from "lucide-react";
import api from "@/lib/api";
import { formatDate } from "@/lib/format-date";
import { tagColors } from "@/lib/constants";
import { useSelectedProject } from "@/hooks/use-project";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DataTable, DataTableColumnHeader, DataTableRowActions, type RowAction } from "@/components/data-table";
import { Form, FormField, FormItem, FormLabel, FormControl, FormMessage } from "@/components/form";
import { Badge } from "@/components/ui/badge";
import { DatePicker } from "@/components/ui/date-picker";

interface Asset { id: string; name: string; tag_number: string; }
interface TagTarget {
  id: string;
  asset_id: string;
  tag_code: string;
  target_date: string;
  actual_achieved_date: string | null;
  status: string;
}

const statusColors: Record<string, string> = {
  not_started: "bg-muted text-muted-foreground",
  in_progress: "bg-amber-500/15 text-amber-500",
  achieved: "bg-emerald-500/15 text-emerald-500",
  delayed: "bg-red-500/15 text-red-500",
  at_risk: "bg-orange-500/15 text-orange-500",
};

const schema = z.object({
  asset_id: z.string().min(1, "Asset is required"),
  tag_code: z.string().min(1, "Tag is required"),
  target_date: z.string().min(1, "Target date is required"),
});

type FormValues = z.infer<typeof schema>;

export default function TagTargetsPage() {
  const project = useSelectedProject();
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<TagTarget | null>(null);

  const { data: assets = [] } = useQuery<Asset[]>({
    queryKey: ["assets", project?.id],
    queryFn: async () => (await api.get("/assets", { params: { project_id: project?.id } })).data,
    enabled: !!project?.id,
  });

  const { data: targets = [], isLoading } = useQuery<TagTarget[]>({
    queryKey: ["tag-targets", project?.id],
    queryFn: async () => (await api.get("/commissioning/tag-targets", { params: { project_id: project?.id } })).data,
    enabled: !!project?.id,
  });

  const assetMap = Object.fromEntries(assets.map((a) => [a.id, a]));

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { asset_id: "", tag_code: "", target_date: "" },
  });

  const mutation = useMutation({
    mutationFn: async (values: FormValues) => {
      if (editing) return api.patch(`/commissioning/tag-targets/${editing.id}`, { target_date: values.target_date });
      return api.post("/commissioning/tag-targets", values);
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["tag-targets"] }); closeDialog(); toast.success(editing ? "Updated" : "Created"); },
  });

  const openCreate = () => { setEditing(null); form.reset({ asset_id: "", tag_code: "", target_date: "" }); setDialogOpen(true); };
  const openEdit = (item: TagTarget) => { setEditing(item); form.reset({ asset_id: item.asset_id, tag_code: item.tag_code, target_date: item.target_date }); setDialogOpen(true); };
  const closeDialog = () => { setDialogOpen(false); setEditing(null); };

  const rowActions: RowAction<TagTarget>[] = [
    { label: "Edit Target Date", onClick: openEdit },
  ];

  const columns: ColumnDef<TagTarget, unknown>[] = [
    { accessorKey: "asset_id", header: ({ column }) => <DataTableColumnHeader column={column} title="Asset" />, cell: ({ row }) => { const a = assetMap[row.original.asset_id]; return a ? <span className="font-mono text-xs">{a.tag_number}</span> : "-"; } },
    { id: "asset_name", header: "Name", cell: ({ row }) => assetMap[row.original.asset_id]?.name || "-" },
    { accessorKey: "tag_code", header: ({ column }) => <DataTableColumnHeader column={column} title="Tag" />, cell: ({ row }) => <Badge className={tagColors[row.original.tag_code] || ""}>{row.original.tag_code}</Badge> },
    { accessorKey: "target_date", header: ({ column }) => <DataTableColumnHeader column={column} title="Target Date" />, cell: ({ row }) => formatDate(row.original.target_date) },
    { accessorKey: "actual_achieved_date", header: "Achieved", cell: ({ row }) => formatDate(row.original.actual_achieved_date) },
    { accessorKey: "status", header: ({ column }) => <DataTableColumnHeader column={column} title="Status" />, cell: ({ row }) => <Badge className={statusColors[row.original.status] || ""}>{row.original.status.replace(/_/g, " ")}</Badge> },
    { id: "actions", header: "", cell: ({ row }) => <DataTableRowActions row={row.original} actions={rowActions} /> },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Tag Targets</h1>
          <p className="text-sm text-muted-foreground">Manage target dates for commissioning tags per asset</p>
        </div>
        <Button onClick={openCreate}><Plus className="mr-2 h-4 w-4" />Add Target</Button>
      </div>
      <DataTable columns={columns} data={targets} searchKey="asset_id" searchPlaceholder="Search..." />

      {/* Bulk Assign */}
      <BulkTagTargets assets={assets} onDone={() => queryClient.invalidateQueries({ queryKey: ["tag-targets"] })} />

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editing ? "Edit Tag Target" : "New Tag Target"}</DialogTitle></DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit((v) => mutation.mutate(v))} noValidate className="space-y-4">
              <FormField control={form.control} name="asset_id" render={({ field }) => (
                <FormItem>
                  <FormLabel>Asset</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value} disabled={!!editing}>
                    <FormControl><SelectTrigger><SelectValue placeholder="Select asset">{field.value ? `${assetMap[field.value]?.tag_number} - ${assetMap[field.value]?.name}` : ""}</SelectValue></SelectTrigger></FormControl>
                    <SelectContent>{assets.map((a) => <SelectItem key={a.id} value={a.id}>{a.tag_number} - {a.name}</SelectItem>)}</SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="tag_code" render={({ field }) => (
                <FormItem>
                  <FormLabel>Tag</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value} disabled={!!editing}>
                    <FormControl><SelectTrigger><SelectValue placeholder="Select tag">{field.value || ""}</SelectValue></SelectTrigger></FormControl>
                    <SelectContent>
                      <SelectItem value="red">Red Tag (L1+L2A)</SelectItem>
                      <SelectItem value="yellow">Yellow Tag (L2B)</SelectItem>
                      <SelectItem value="green">Green Tag (L3)</SelectItem>
                      <SelectItem value="blue">Blue Tag (L4)</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="target_date" render={({ field }) => (
                <FormItem><FormLabel>Target Date</FormLabel><FormControl><DatePicker value={field.value} onChange={field.onChange} /></FormControl><FormMessage /></FormItem>
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

function BulkTagTargets({ assets, onDone }: { assets: Asset[]; onDone: () => void }) {
  const [tagCode, setTagCode] = useState("");
  const [targetDate, setTargetDate] = useState("");
  const [loading, setLoading] = useState(false);

  const handleBulkAssign = async () => {
    if (!tagCode || !targetDate || assets.length === 0) return;
    setLoading(true);
    try {
      let count = 0;
      for (const asset of assets) {
        try {
          await api.post("/commissioning/tag-targets", { asset_id: asset.id, tag_code: tagCode, target_date: targetDate });
          count++;
        } catch { /* skip duplicates */ }
      }
      toast.success(`Assigned ${tagCode} tag target to ${count} assets`);
      onDone();
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="rounded-lg border p-4 space-y-3">
      <p className="text-sm font-medium">Bulk Assign Tag Targets</p>
      <p className="text-xs text-muted-foreground">Set the same target date for all assets at once.</p>
      <div className="flex gap-3 items-end">
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">Tag</label>
          <Select value={tagCode} onValueChange={(v: any) => setTagCode(v)}>
            <SelectTrigger className="w-40"><SelectValue placeholder="Select tag">{tagCode || ""}</SelectValue></SelectTrigger>
            <SelectContent>
              <SelectItem value="red">Red Tag</SelectItem>
              <SelectItem value="yellow">Yellow Tag</SelectItem>
              <SelectItem value="green">Green Tag</SelectItem>
              <SelectItem value="blue">Blue Tag</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">Target Date</label>
          <DatePicker value={targetDate} onChange={setTargetDate} />
        </div>
        <Button disabled={!tagCode || !targetDate || loading} onClick={handleBulkAssign}>
          {loading ? "Assigning..." : `Assign to All ${assets.length} Assets`}
        </Button>
      </div>
    </div>
  );
}
