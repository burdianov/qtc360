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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { DataTable, DataTableColumnHeader, DataTableRowActions, type RowAction } from "@/components/data-table";
import { Form, FormField, FormItem, FormLabel, FormControl, FormMessage } from "@/components/form";

interface Project {
  id: string;
  name: string;
  code: string;
  description: string | null;
  status: string;
  client: { id: string; name: string; code: string } | null;
  created_at: string;
}

const schema = z.object({
  name: z.string().min(1, "Name is required"),
  code: z.string().min(1, "Code is required"),
  description: z.string(),
  status: z.string(),
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

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { name: "", code: "", description: "", status: "active", client_id: "" },
  });

  const mutation = useMutation({
    mutationFn: async (values: FormValues) => {
      const payload = { ...values, client_id: values.client_id || null };
      if (editing) {
        return api.patch(`/projects/${editing.id}`, payload);
      }
      return api.post("/projects", payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      closeDialog();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/projects/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["projects"] }),
  });

  const openCreate = () => {
    setEditing(null);
    form.reset({ name: "", code: "", description: "", status: "active", client_id: "" });
    setDialogOpen(true);
  };

  const openEdit = (project: Project) => {
    setEditing(project);
    form.reset({
      name: project.name,
      code: project.code,
      description: project.description || "",
      status: project.status,
      client_id: project.client?.id || "",
    });
    setDialogOpen(true);
  };

  const closeDialog = () => {
    setDialogOpen(false);
    setEditing(null);
  };

  const rowActions: RowAction<Project>[] = [
    { label: "Edit", onClick: openEdit },
    { label: "Delete", onClick: (row) => deleteMutation.mutate(row.id), destructive: true, separator: true },
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
        ])}
        onImport={async (file) => {
          const rows = await parseCsv(file);
          for (const row of rows) {
            await api.post("/projects", row);
          }
          queryClient.invalidateQueries({ queryKey: ["projects"] });
        }}
        onDownloadTemplate={() => downloadTemplate(["name", "code", "description", "status", "client_id"], "projects")}
        onBulkDelete={async (rows) => {
          for (const row of rows) await api.delete(`/projects/${row.id}`);
          queryClient.invalidateQueries({ queryKey: ["projects"] });
        }}
      />

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? "Edit Project" : "Add Project"}</DialogTitle>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit((v) => mutation.mutate(v))} noValidate className="space-y-4">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Name</FormLabel>
                    <FormControl><Input {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="code"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Code</FormLabel>
                    <FormControl><Input {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="description"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Description</FormLabel>
                    <FormControl><Input {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <div className="flex justify-end gap-2 pt-2">
                <Button type="button" variant="outline" onClick={closeDialog}>Cancel</Button>
                <Button type="submit" disabled={mutation.isPending}>
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
