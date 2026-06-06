"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { z } from "zod/v4";
import { zodResolver } from "@hookform/resolvers/zod";
import { type ColumnDef } from "@tanstack/react-table";
import { Check, ChevronsUpDown, Plus } from "lucide-react";

import api from "@/lib/api";
import { formatDate } from "@/lib/format-date";
import { useSelectedProject } from "@/hooks/use-project";
import {
  DataTable,
  DataTableColumnHeader,
  DataTableRowActions,
} from "@/components/data-table";
import { Badge } from "@/components/ui/badge";
import { tagColors } from "@/lib/constants";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/form";
import { cn } from "@/lib/utils";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

interface Asset {
  id: string;
  name: string;
  tag_number: string;
}

interface RequirementTemplate {
  id: string;
  name: string;
  code: string;
  level_code: string;
  requirement_category: string;
  evidence_document_type: string;
  is_active?: boolean;
}

interface AssetRequirement {
  id: string;
  asset_id: string;
  requirement_template_id: string;
  status: string;
  progress_percent: number;
  required_for_tag: string;
  target_date: string | null;
  actual_completion_date: string | null;
  approved_date: string | null;
  notes: string | null;
}

const statusColors: Record<string, string> = {
  not_started: "bg-muted text-muted-foreground",
  submitted: "bg-amber-500/15 text-amber-500",
  partial: "bg-orange-500/15 text-orange-500",
  achieved: "bg-emerald-500/15 text-emerald-500",
  rejected: "bg-red-500/15 text-red-500",
  not_applicable: "bg-muted text-muted-foreground",
};

const levelColors: Record<string, string> = {
  L1: "bg-red-500/15 text-red-500",
  L2A: "bg-red-500/15 text-red-500",
  L2B: "bg-yellow-500/15 text-yellow-600",
  L3: "bg-emerald-500/15 text-emerald-500",
  L4: "bg-blue-500/15 text-blue-500",
  L5: "bg-purple-500/15 text-purple-500",
};

const schema = z.object({
  requirement_template_id: z.string().min(1, "Requirement is required"),
  required_for_tag: z.enum(["red", "yellow", "green", "blue"]),
  target_date: z.string().optional(),
  notes: z.string().optional(),
});

type FormValues = z.infer<typeof schema>;

export default function CommissioningRequirementsPage() {
  const project = useSelectedProject();
  const queryClient = useQueryClient();

  const [selectedAssetId, setSelectedAssetId] = useState("");
  const [assetComboboxOpen, setAssetComboboxOpen] = useState(false);
  const [requirementComboboxOpen, setRequirementComboboxOpen] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingRequirement, setEditingRequirement] =
    useState<AssetRequirement | null>(null);

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      requirement_template_id: "",
      required_for_tag: "red",
      target_date: "",
      notes: "",
    },
  });

  const { data: assets = [] } = useQuery<Asset[]>({
    queryKey: ["assets", project?.id],
    queryFn: async () =>
      (await api.get("/assets", { params: { project_id: project?.id } })).data,
    enabled: !!project?.id,
  });

  const { data: templates = [] } = useQuery<RequirementTemplate[]>({
    queryKey: ["requirement-templates", project?.id],
    queryFn: async () =>
      (
        await api.get("/commissioning/requirement-templates", {
          params: { project_id: project?.id },
        })
      ).data,
    enabled: !!project?.id,
  });

  const { data: requirements = [] } = useQuery<AssetRequirement[]>({
    queryKey: ["asset-requirements", selectedAssetId],
    queryFn: async () =>
      (
        await api.get("/commissioning/asset-requirements", {
          params: { asset_id: selectedAssetId },
        })
      ).data,
    enabled: !!selectedAssetId,
  });

  const assignMutation = useMutation({
    mutationFn: async (values: FormValues) => {
      return api.post("/commissioning/asset-requirements", {
        asset_id: selectedAssetId,
        requirement_template_id: values.requirement_template_id,
        required_for_tag: values.required_for_tag,
        target_date: values.target_date || null,
        notes: values.notes || null,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["asset-requirements", selectedAssetId],
      });
      queryClient.invalidateQueries({ queryKey: ["asset-requirements-all"] });
      setDialogOpen(false);
      form.reset({
        requirement_template_id: "",
        required_for_tag: "red",
        target_date: "",
        notes: "",
      });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async (values: FormValues) => {
      if (!editingRequirement) {
        throw new Error("No requirement selected");
      }

      return api.patch(
        `/commissioning/asset-requirements/${editingRequirement.id}`,
        {
          requirement_template_id: values.requirement_template_id,
          required_for_tag: values.required_for_tag,
          target_date: values.target_date || null,
          notes: values.notes || null,
        },
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["asset-requirements", selectedAssetId],
      });
      queryClient.invalidateQueries({ queryKey: ["asset-requirements-all"] });
      setDialogOpen(false);
      setEditingRequirement(null);
      form.reset({
        requirement_template_id: "",
        required_for_tag: "red",
        target_date: "",
        notes: "",
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (assetRequirementId: string) => {
      return api.delete(
        `/commissioning/asset-requirements/${assetRequirementId}`,
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["asset-requirements", selectedAssetId],
      });
      queryClient.invalidateQueries({ queryKey: ["asset-requirements-all"] });
    },
  });

  const templateMap = useMemo(
    () => Object.fromEntries(templates.map((t) => [t.id, t])),
    [templates],
  );

  const assignedTemplateIds = useMemo(
    () => new Set(requirements.map((r) => r.requirement_template_id)),
    [requirements],
  );

  const availableTemplates = templates.filter(
    (t) =>
      t.id === editingRequirement?.requirement_template_id ||
      (t.is_active !== false && !assignedTemplateIds.has(t.id)),
  );

  const selectedAsset = assets.find((a) => a.id === selectedAssetId);

  const tableData = requirements.map((r) => ({
    ...r,
    template: templateMap[r.requirement_template_id],
    requirement_name: templateMap[r.requirement_template_id]?.name || "",
  }));

  type Row = (typeof tableData)[number];

  const columns: ColumnDef<Row, unknown>[] = [
    {
      accessorKey: "template.level_code",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="Level" />
      ),
      cell: ({ row }) => {
        const level = row.original.template?.level_code || "";
        return <Badge className={levelColors[level] || ""}>{level}</Badge>;
      },
    },
    {
      accessorKey: "template.code",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="Code" />
      ),
      cell: ({ row }) => (
        <span className="font-mono text-xs">{row.original.template?.code}</span>
      ),
    },
    {
      accessorKey: "requirement_name",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="Requirement" />
      ),
      cell: ({ row }) => row.original.template?.name || "-",
    },
    {
      accessorKey: "status",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="Status" />
      ),
      cell: ({ row }) => (
        <Badge className={statusColors[row.original.status] || ""}>
          {row.original.status.replace(/_/g, " ")}
        </Badge>
      ),
    },
    {
      accessorKey: "progress_percent",
      header: "Progress",
      cell: ({ row }) => (
        <div className="flex items-center gap-2 min-w-20">
          <div className="h-1.5 flex-1 rounded-full bg-primary/20 overflow-hidden">
            <div
              className="h-full bg-primary rounded-full"
              style={{ width: `${row.original.progress_percent}%` }}
            />
          </div>
          <span className="text-[10px] text-muted-foreground w-7">
            {row.original.progress_percent}%
          </span>
        </div>
      ),
    },
    {
      accessorKey: "required_for_tag",
      header: "Tag",
      cell: ({ row }) => (
        <Badge
          className={`text-xs capitalize ${tagColors[row.original.required_for_tag] || ""}`}
        >
          {row.original.required_for_tag}
        </Badge>
      ),
    },
    {
      accessorKey: "target_date",
      header: "Target",
      cell: ({ row }) => (
        <span className="text-xs">{formatDate(row.original.target_date)}</span>
      ),
    },
    {
      accessorKey: "actual_completion_date",
      header: "Completed",
      cell: ({ row }) => (
        <span className="text-xs">
          {formatDate(row.original.actual_completion_date)}
        </span>
      ),
    },
    {
      accessorKey: "approved_date",
      header: "Approved",
      cell: ({ row }) => (
        <span className="text-xs">
          {formatDate(row.original.approved_date)}
        </span>
      ),
    },
    {
      id: "actions",
      header: "Actions",
      enableSorting: false,
      enableHiding: false,
      cell: ({ row }) => (
        <DataTableRowActions
          row={row.original}
          actions={[
            {
              label: "Edit",
              onClick: (requirement) => openEditDialog(requirement),
            },
            {
              label: "Delete",
              destructive: true,
              separator: true,
              confirm:
                "Remove this requirement from the selected asset? The requirement master will not be deleted.",
              onClick: (requirement) => deleteMutation.mutate(requirement.id),
            },
          ]}
        />
      ),
    },
  ];

  const openEditDialog = (requirement: AssetRequirement) => {
    setEditingRequirement(requirement);
    form.reset({
      requirement_template_id: requirement.requirement_template_id,
      required_for_tag:
        requirement.required_for_tag as FormValues["required_for_tag"],
      target_date: requirement.target_date || "",
      notes: requirement.notes || "",
    });
    setRequirementComboboxOpen(false);
    setDialogOpen(true);
  };

  const openAssignDialog = () => {
    setEditingRequirement(null);
    form.reset({
      requirement_template_id: "",
      required_for_tag: "red",
      target_date: "",
      notes: "",
    });
    setRequirementComboboxOpen(false);
    setDialogOpen(true);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Asset Requirements
          </h1>
          <p className="text-sm text-muted-foreground">
            View and assign commissioning requirements per asset
          </p>
        </div>

        <Button onClick={openAssignDialog} disabled={!selectedAssetId}>
          <Plus className="mr-2 h-4 w-4" />
          Assign Requirement
        </Button>
      </div>

      <div className="max-w-sm">
        <label className="mb-1.5 block text-xs text-muted-foreground">
          Select Asset
        </label>

        <Popover open={assetComboboxOpen} onOpenChange={setAssetComboboxOpen}>
          <PopoverTrigger
            type="button"
            role="combobox"
            aria-expanded={assetComboboxOpen}
            className={cn(
              "inline-flex h-9 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm font-normal shadow-xs transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              !selectedAsset && "text-muted-foreground",
            )}
          >
            <span className="truncate">
              {selectedAsset
                ? `${selectedAsset.tag_number} - ${selectedAsset.name}`
                : "Choose an asset..."}
            </span>
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </PopoverTrigger>

          <PopoverContent
            align="start"
            className="w-(--radix-popover-trigger-width) p-0"
          >
            <Command>
              <CommandInput placeholder="Search asset name or tag..." />
              <CommandList>
                <CommandEmpty>No asset found.</CommandEmpty>
                <CommandGroup>
                  {assets.map((asset) => (
                    <CommandItem
                      key={asset.id}
                      value={`${asset.name} ${asset.tag_number}`}
                      onSelect={() => {
                        setSelectedAssetId(asset.id);
                        setAssetComboboxOpen(false);
                      }}
                    >
                      <div className="min-w-0">
                        <div className="truncate font-medium">{asset.name}</div>
                        <div className="truncate font-mono text-xs text-muted-foreground">
                          {asset.tag_number}
                        </div>
                      </div>

                      <Check
                        className={cn(
                          "ml-auto h-4 w-4",
                          selectedAssetId === asset.id
                            ? "opacity-100"
                            : "opacity-0",
                        )}
                      />
                    </CommandItem>
                  ))}
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
      </div>

      {selectedAssetId ? (
        <DataTable
          columns={columns}
          data={tableData}
          searchKey="requirement_name"
          searchPlaceholder="Search requirements..."
        />
      ) : (
        <div className="flex h-48 items-center justify-center text-sm text-muted-foreground border rounded-lg">
          Select an asset to view or assign commissioning requirements
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {editingRequirement ? "Edit Requirement" : "Assign Requirement"}
            </DialogTitle>
            <DialogDescription>
              {editingRequirement
                ? `Update the requirement assigned to ${selectedAsset?.tag_number} - ${selectedAsset?.name}.`
                : `Add a commissioning requirement to ${selectedAsset?.tag_number} - ${selectedAsset?.name}.`}
            </DialogDescription>
          </DialogHeader>

          <Form {...form}>
            <form
              onSubmit={form.handleSubmit((values) =>
                editingRequirement
                  ? updateMutation.mutate(values)
                  : assignMutation.mutate(values),
              )}
              noValidate
              className="space-y-4"
            >
              <FormField
                control={form.control}
                name="requirement_template_id"
                render={({ field }) => {
                  const selectedTemplate = templates.find(
                    (t) => t.id === field.value,
                  );

                  return (
                    <FormItem>
                      <FormLabel>Requirement</FormLabel>
                      <Popover
                        open={requirementComboboxOpen}
                        onOpenChange={setRequirementComboboxOpen}
                      >
                        <FormControl>
                          <PopoverTrigger
                            type="button"
                            role="combobox"
                            aria-expanded={requirementComboboxOpen}
                            className={cn(
                              "inline-flex h-9 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm font-normal shadow-xs transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                              !selectedTemplate && "text-muted-foreground",
                            )}
                          >
                            <span className="truncate">
                              {selectedTemplate
                                ? `[${selectedTemplate.level_code}] ${selectedTemplate.code} - ${selectedTemplate.name}`
                                : "Select requirement..."}
                            </span>
                            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                          </PopoverTrigger>
                        </FormControl>

                        <PopoverContent
                          align="start"
                          className="w-(--radix-popover-trigger-width) p-0"
                        >
                          <Command>
                            <CommandInput placeholder="Search requirement name, code, or level..." />
                            <CommandList>
                              <CommandEmpty>No requirement found.</CommandEmpty>
                              <CommandGroup>
                                {availableTemplates.map((template) => (
                                  <CommandItem
                                    key={template.id}
                                    value={`${template.name} ${template.code} ${template.level_code}`}
                                    onSelect={() => {
                                      field.onChange(template.id);
                                      setRequirementComboboxOpen(false);
                                    }}
                                  >
                                    <div className="min-w-0">
                                      <div className="truncate font-medium">
                                        {template.name}
                                      </div>
                                      <div className="truncate font-mono text-xs text-muted-foreground">
                                        [{template.level_code}] {template.code}
                                      </div>
                                    </div>

                                    <Check
                                      className={cn(
                                        "ml-auto h-4 w-4",
                                        field.value === template.id
                                          ? "opacity-100"
                                          : "opacity-0",
                                      )}
                                    />
                                  </CommandItem>
                                ))}
                              </CommandGroup>
                            </CommandList>
                          </Command>
                        </PopoverContent>
                      </Popover>
                      {availableTemplates.length === 0 && (
                        <p className="text-xs text-muted-foreground">
                          All active requirement templates are already assigned
                          to this asset.
                        </p>
                      )}
                      <FormMessage />
                    </FormItem>
                  );
                }}
              />

              <FormField
                control={form.control}
                name="required_for_tag"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Required For Tag</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="red">Red</SelectItem>
                        <SelectItem value="yellow">Yellow</SelectItem>
                        <SelectItem value="green">Green</SelectItem>
                        <SelectItem value="blue">Blue</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="target_date"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Target Date</FormLabel>
                    <FormControl>
                      <DatePicker
                        value={field.value}
                        onChange={field.onChange}
                        placeholder="Select target date"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="notes"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Notes</FormLabel>
                    <FormControl>
                      <Textarea
                        rows={3}
                        placeholder="Optional notes..."
                        value={field.value || ""}
                        onChange={field.onChange}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {(assignMutation.isError || updateMutation.isError) && (
                <p className="text-sm text-destructive">
                  Requirement could not be saved. It may already be assigned to
                  this asset.
                </p>
              )}

              {deleteMutation.isError && (
                <p className="text-sm text-destructive">
                  Requirement could not be removed. It may already be linked to
                  a document.
                </p>
              )}

              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setDialogOpen(false);
                    setEditingRequirement(null);
                  }}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={
                    assignMutation.isPending ||
                    updateMutation.isPending ||
                    availableTemplates.length === 0
                  }
                  aria-busy={assignMutation.isPending || updateMutation.isPending || undefined}
                >
                  {(assignMutation.isPending || updateMutation.isPending) && (
                    <Spinner size="sm" className="mr-1 text-current" />
                  )}
                  {editingRequirement
                    ? updateMutation.isPending
                      ? "Saving…"
                      : "Save Changes"
                    : assignMutation.isPending
                      ? "Assigning…"
                      : "Assign"}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
