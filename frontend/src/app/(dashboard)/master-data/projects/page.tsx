"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { z } from "zod/v4";
import { zodResolver } from "@hookform/resolvers/zod";
import { type ColumnDef } from "@tanstack/react-table";
import { Plus } from "lucide-react";
import api from "@/lib/api";
import { toast } from "sonner";
import { exportToCsv, parseCsv, downloadTemplate } from "@/lib/csv";
import { formatDate } from "@/lib/format-date";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DatePicker } from "@/components/ui/date-picker";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { DataTable, DataTableColumnHeader, DataTableRowActions, type RowAction } from "@/components/data-table";
import { Form, FormField, FormItem, FormLabel, FormControl, FormMessage } from "@/components/form";

interface Client {
  id: string;
  name: string;
  code: string;
}

interface Project {
  id: string;
  name: string;
  code: string;
  description: string | null;
  status: string;
  start_date: string | null;
  end_date: string | null;
  client: Client | null;
  created_at: string;
}

const schema = z.object({
  name: z.string().min(1, "Name is required"),
  code: z.string().min(1, "Code is required"),
  description: z.string(),
  status: z.string().min(1, "Status is required"),
  start_date: z.string(),
  end_date: z.string(),
  client_id: z.string(),
});

type FormValues = z.infer<typeof schema>;

export default function ProjectsPage() {
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Project | null>(null);

  const { data: projects = [], isLoading } = useQuery<Project[]>({
    queryKey: ["projects"],
    queryFn: async () => (await api.get("/projects")).data,
  });

  const { data: clients = [] } = useQuery<Client[]>({
    queryKey: ["clients"],
    queryFn: async () => (await api.get("/clients")).data,
  });

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { name: "", code: "", description: "", status: "active", start_date: "", end_date: "", client_id: "" },
  });

  const { isDirty } = form.formState;

  const mutation = useMutation({
    mutationFn: async (values: FormValues) => {
      const payload: Record<string, unknown> = {
        name: values.name,
        code: values.code,
        status: values.status,
        description: values.description || null,
        client_id: values.client_id || null,
        start_date: values.start_date || null,
        end_date: values.end_date || null,
      };
      if (editing) return api.patch(`/projects/${editing.id}`, payload);
      return api.post("/projects", payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      setDialogOpen(false);
      setEditing(null);
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail || "Failed to save";
      toast.error(msg);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/projects/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["projects"] }),
  });

  const openCreate = () => {
    setEditing(null);
    form.reset({ name: "", code: "", description: "", status: "active", start_date: "", end_date: "", client_id: "" });
    setDialogOpen(true);
  };

  const openEdit = (project: Project) => {
    setEditing(project);
    form.reset({
      name: project.name,
      code: project.code,
      description: project.description || "",
      status: project.status,
      start_date: project.start_date || "",
      end_date: project.end_date || "",
      client_id: project.client?.id || "",
    });
    setDialogOpen(true);
  };

  const rowActions: RowAction<Project>[] = [
    { label: "Edit", onClick: openEdit },
    { label: "Delete", onClick: (row) => deleteMutation.mutate(row.id), destructive: true, separator: true, confirm: "Are you sure you want to delete this item? This action cannot be undone." },
  ];

  const columns: ColumnDef<Project, unknown>[] = [
    {
      accessorKey: "code",
      header: ({ column }) => <DataTableColumnHeader column={column} title="Code" />,
    },
    {
      accessorKey: "name",
      header: ({ column }) => <DataTableColumnHeader column={column} title="Name" />,
    },
    {
      accessorKey: "status",
      header: ({ column }) => <DataTableColumnHeader column={column} title="Status" />,
      cell: ({ row }) => (
        <span className="capitalize">{row.getValue("status")}</span>
      ),
    },
    {
      id: "client",
      accessorFn: (row) => row.client?.name ?? "—",
      header: ({ column }) => <DataTableColumnHeader column={column} title="Client" />,
    },
    {
      accessorKey: "description",
      header: ({ column }) => <DataTableColumnHeader column={column} title="Description" />,
      cell: ({ row }) => row.getValue("description") || "—",
    },
    {
      accessorKey: "start_date",
      header: ({ column }) => <DataTableColumnHeader column={column} title="Start Date" />,
      cell: ({ row }) => formatDate(row.getValue("start_date") as string),
    },
    {
      accessorKey: "end_date",
      header: ({ column }) => <DataTableColumnHeader column={column} title="End Date" />,
      cell: ({ row }) => formatDate(row.getValue("end_date") as string),
    },
    {
      id: "actions",
      header: "Actions",
      cell: ({ row }) => <DataTableRowActions row={row.original} actions={rowActions} />,
    },
  ];

  if (isLoading) return <div className="p-6">Loading...</div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Projects</h1>
          <p className="text-sm text-muted-foreground">Manage your projects</p>
        </div>
        <Button onClick={openCreate}>
          <Plus className="mr-2 h-4 w-4" />
          Add Project
        </Button>
      </div>

      <DataTable
        columns={columns}
        data={projects}
        searchKey="name"
        searchPlaceholder="Search by name..."
        onExport={(rows) => exportToCsv(rows, "projects", [
          { key: "code", label: "code" },
          { key: "name", label: "name" },
          { key: "status", label: "status" },
          { key: "client.name", label: "client" },
          { key: "description", label: "description" },
          { key: "start_date", label: "start_date" },
          { key: "end_date", label: "end_date" },
        ])}
        onImport={async (file) => {
          const rows = await parseCsv(file);
          for (const row of rows) {
            await api.post("/projects", row);
          }
          queryClient.invalidateQueries({ queryKey: ["projects"] });
        }}
        onDownloadTemplate={() => downloadTemplate(["name", "code", "description", "status", "start_date", "end_date", "client_id"], "projects")}
        onBulkDelete={async (rows) => {
          await Promise.allSettled(rows.map((row) => api.delete(`/projects/${row.id}`)));
          queryClient.invalidateQueries({ queryKey: ["projects"] });
        }}
      />

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit Project" : "Add Project"}</DialogTitle>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit((v) => mutation.mutate(v))} noValidate className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <FormField control={form.control} name="name" render={({ field }) => (
                  <FormItem><FormLabel>Name</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
                )} />
                <FormField control={form.control} name="code" render={({ field }) => (
                  <FormItem><FormLabel>Code</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
                )} />
              </div>
              <FormField control={form.control} name="description" render={({ field }) => (
                <FormItem><FormLabel>Description</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
              )} />
              <div className="grid grid-cols-2 gap-4">
                <FormField control={form.control} name="client_id" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Client</FormLabel>
                    <Select value={field.value || undefined} onValueChange={field.onChange}>
                      <FormControl><SelectTrigger><SelectValue placeholder="Select client">{field.value ? clients.find((c) => c.id === field.value)?.name : ""}</SelectValue></SelectTrigger></FormControl>
                      <SelectContent>
                        {clients.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="status" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Status</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl><SelectTrigger><SelectValue placeholder="Select status">{{ active: "Active", completed: "Completed", on_hold: "On Hold" }[field.value] || ""}</SelectValue></SelectTrigger></FormControl>
                      <SelectContent>
                        <SelectItem value="active">Active</SelectItem>
                        <SelectItem value="completed">Completed</SelectItem>
                        <SelectItem value="on_hold">On Hold</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )} />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <FormField control={form.control} name="start_date" render={({ field }) => (
                  <FormItem><FormLabel>Start Date</FormLabel><FormControl><DatePicker value={field.value} onChange={field.onChange} /></FormControl><FormMessage /></FormItem>
                )} />
                <FormField control={form.control} name="end_date" render={({ field }) => (
                  <FormItem><FormLabel>End Date</FormLabel><FormControl><DatePicker value={field.value} onChange={field.onChange} /></FormControl><FormMessage /></FormItem>
                )} />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
                <Button type="submit" disabled={mutation.isPending || (!!editing && !isDirty)}>
                  {mutation.isPending ? "Saving..." : editing ? "Update" : "Create"}
                </Button>
              </div>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
