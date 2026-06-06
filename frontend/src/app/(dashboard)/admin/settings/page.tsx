"use client";

import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import api from "@/lib/api";
import { toast } from "sonner";
import Image from "next/image";
import { useSelectedProject } from "@/hooks/use-project";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs } from "@/components/ui/tabs";
import { Spinner } from "@/components/ui/spinner";
import { Pencil, Trash2, Plus, Check, X } from "lucide-react";
import { ProjectApproversCard } from "./project-approvers-card";
import { MAX_HEADER_IMAGE_BYTES } from "@/lib/constants";
import { formatSizeCap } from "@/lib/upload";

const DOC_TYPES = ["WIR", "MIR", "CIR", "FAT", "CRS"] as const;
const DEFAULT_PATTERN =
  "{project_code}-{contractor_code}-{discipline_code}-{doc_type}-{serial:04d}";

interface RefConfig {
  id: string;
  project_id: string;
  doc_type: string;
  pattern: string;
  project_code: string;
  contractor_code: string;
  serial_start: number;
}

function previewPattern(
  pattern: string,
  projectCode: string,
  contractorCode: string,
  docType: string,
): string {
  return pattern
    .replace(/{project_code}/g, projectCode || "PROJ")
    .replace(/{contractor_code}/g, contractorCode || "CONT")
    .replace(/{discipline_code}/g, "EL")
    .replace(/{doc_type}/g, docType)
    .replace(/{serial:04d}/g, "0001")
    .replace(/{serial}/g, "1");
}

function RefConfigRow({
  docType,
  config,
  projectId,
  onSaved,
  onDeleted,
}: {
  docType: string;
  config?: RefConfig;
  projectId: string;
  onSaved: () => void;
  onDeleted: () => void;
}) {
  const [editing, setEditing] = useState(!config);
  const [projectCode, setProjectCode] = useState(config?.project_code ?? "");
  const [contractorCode, setContractorCode] = useState(
    config?.contractor_code ?? "",
  );
  const [pattern, setPattern] = useState(config?.pattern ?? DEFAULT_PATTERN);
  const [serialStart, setSerialStart] = useState(config?.serial_start ?? 1);

  const qc = useQueryClient();

  const saveMutation = useMutation({
    mutationFn: () =>
      api.post("/ref-config", {
        project_id: projectId,
        doc_type: docType,
        pattern,
        project_code: projectCode,
        contractor_code: contractorCode,
        serial_start: serialStart,
      }),
    onSuccess: () => {
      toast.success(`${docType} config saved`);
      qc.invalidateQueries({ queryKey: ["ref-configs", projectId] });
      setEditing(false);
      onSaved();
    },
    onError: (e: any) => {
      toast.error(e?.response?.data?.detail ?? "Save failed");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => api.delete(`/ref-config/${config!.id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ref-configs", projectId] });
      onDeleted();
    },
  });

  const preview = previewPattern(pattern, projectCode, contractorCode, docType);
  const canSave = projectCode.trim().length > 0 && !saveMutation.isPending;

  if (!editing && config) {
    return (
      <div className="flex items-center justify-between px-4 py-3 text-sm group">
        <div className="flex items-center gap-4 min-w-0">
          <span className="font-medium w-10 shrink-0">{docType}</span>
          <code className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded truncate">
            {previewPattern(
              config.pattern,
              config.project_code,
              config.contractor_code,
              docType,
            )}
          </code>
        </div>
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0"
            onClick={() => setEditing(true)}
          >
            <Pencil className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0 text-destructive hover:text-destructive"
            onClick={() => deleteMutation.mutate()}
            disabled={deleteMutation.isPending}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="px-4 py-3 space-y-3 bg-muted/30">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">{docType}</span>
        {config && (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0"
            onClick={() => {
              setProjectCode(config.project_code);
              setContractorCode(config.contractor_code);
              setPattern(config.pattern);
              setSerialStart(config.serial_start);
              setEditing(false);
            }}
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">
            Project Code
          </label>
          <Input
            value={projectCode}
            onChange={(e) => setProjectCode(e.target.value.toUpperCase())}
            placeholder="MERC"
            className="h-8 text-sm"
          />
        </div>
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">
            Contractor Code
          </label>
          <Input
            value={contractorCode}
            onChange={(e) => setContractorCode(e.target.value.toUpperCase())}
            placeholder="JMJV"
            className="h-8 text-sm"
          />
        </div>
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">
            Serial Starts At
          </label>
          <Input
            type="number"
            min={1}
            value={serialStart}
            onChange={(e) => setSerialStart(Number(e.target.value))}
            className="h-8 text-sm"
          />
        </div>
        <div className="sm:col-span-2">
          <label className="text-xs text-muted-foreground mb-1 block">
            Pattern
          </label>
          <Input
            value={pattern}
            onChange={(e) => setPattern(e.target.value)}
            className="h-8 text-sm font-mono"
            placeholder={DEFAULT_PATTERN}
          />
          <p className="text-[10px] text-muted-foreground mt-1">
            Variables:{" "}
            <code className="bg-muted px-0.5 rounded">{"{project_code}"}</code>{" "}
            <code className="bg-muted px-0.5 rounded">
              {"{contractor_code}"}
            </code>{" "}
            <code className="bg-muted px-0.5 rounded">
              {"{discipline_code}"}
            </code>{" "}
            <code className="bg-muted px-0.5 rounded">{"{doc_type}"}</code>{" "}
            <code className="bg-muted px-0.5 rounded">{"{serial:04d}"}</code>
          </p>
        </div>
      </div>

      <div className="flex items-center justify-between pt-1">
        <div className="text-xs text-muted-foreground">
          Preview:{" "}
          <code className="bg-muted px-1.5 py-0.5 rounded text-foreground">
            {preview}
          </code>
        </div>
        <Button
          size="sm"
          className="h-7 gap-1.5"
          onClick={() => saveMutation.mutate()}
          disabled={!canSave}
        >
          <Check className="h-3.5 w-3.5" />
          {saveMutation.isPending && <Spinner size="sm" className="text-current" />}
          {saveMutation.isPending ? "Saving…" : "Save"}
        </Button>
      </div>
    </div>
  );
}

function ReferenceNumberCard({ projectId }: { projectId?: string }) {
  const [adding, setAdding] = useState<string | null>(null);

  const { data: configs = [] } = useQuery<RefConfig[]>({
    queryKey: ["ref-configs", projectId],
    queryFn: async () =>
      (await api.get("/ref-config", { params: { project_id: projectId } }))
        .data,
    enabled: !!projectId,
  });

  const configured = new Set(configs.map((c) => c.doc_type));
  const unconfigured = DOC_TYPES.filter((dt) => !configured.has(dt));

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Reference Number Configuration</CardTitle>
        <p className="text-sm text-muted-foreground">
          One configuration per document type. The reference number is generated
          per discipline — e.g.{" "}
          <code className="text-xs bg-muted px-1 py-0.5 rounded">
            MERC-JMJV-EL-WIR-0031
          </code>{" "}
          where <code className="text-xs bg-muted px-1 py-0.5 rounded">EL</code>{" "}
          is the discipline code assigned when creating the document.
        </p>
      </CardHeader>
      <CardContent className="p-0">
        {configs.length === 0 && !adding && (
          <div className="px-4 py-6 text-sm text-muted-foreground text-center">
            No configurations yet. Add one for each document type you use.
          </div>
        )}

        {configs.length > 0 && (
          <div className="border-t divide-y">
            {configs.map((c) => (
              <RefConfigRow
                key={c.id}
                docType={c.doc_type}
                config={c}
                projectId={projectId!}
                onSaved={() => {}}
                onDeleted={() => {}}
              />
            ))}
          </div>
        )}

        {adding && (
          <div className="border-t">
            <RefConfigRow
              docType={adding}
              projectId={projectId!}
              onSaved={() => setAdding(null)}
              onDeleted={() => setAdding(null)}
            />
          </div>
        )}

        {unconfigured.length > 0 && !adding && (
          <div className="border-t px-4 py-3 flex items-center gap-2 flex-wrap">
            <span className="text-xs text-muted-foreground">Add config for:</span>
            {unconfigured.map((dt) => (
              <Button
                key={dt}
                variant="outline"
                size="sm"
                className="h-7 gap-1.5 text-xs"
                onClick={() => setAdding(dt)}
              >
                <Plus className="h-3 w-3" />
                {dt}
              </Button>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function SettingsPage() {
  const project = useSelectedProject();
  const projectId = project?.id;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground">
          Project configuration and preferences
        </p>
      </div>

      <Tabs
        tabs={[
          {
            id: "reference",
            label: "Reference Numbers",
            content: <ReferenceNumberCard projectId={projectId} />,
          },
          {
            id: "approvers",
            label: "Approvers",
            content: <ProjectApproversCard projectId={projectId} />,
          },
          {
            id: "general",
            label: "General",
            content: (
              <>
                <DateFormatCard />
                <div className="mt-4">
                  <RevisionSuffixCard />
                </div>
                <div className="mt-4">
                  <AssetCustomFieldsCard />
                </div>
              </>
            ),
          },
          {
            id: "signatures",
            label: "Signatures",
            content: <SignatureConfigCard />,
          },
          {
            id: "crs-header",
            label: "CRS Header",
            content: <CrsHeaderCard />,
          },
        ]}
      />
    </div>
  );
}

function DateFormatCard() {
  const qc = useQueryClient();
  const [dateFormat, setDateFormat] = useState("");
  const [loaded, setLoaded] = useState(false);

  const { data } = useQuery<{ key: string; value: string }>({
    queryKey: ["app-setting", "date_format"],
    queryFn: async () => (await api.get("/admin/settings/date_format")).data,
  });

  if (data && !loaded) {
    setDateFormat(data.value);
    setLoaded(true);
  }

  const saveMutation = useMutation({
    mutationFn: () =>
      api.put("/admin/settings/date_format", { value: dateFormat }),
    onSuccess: () => {
      toast.success("Date format saved");
      qc.invalidateQueries({ queryKey: ["app-setting", "date_format"] });
    },
  });

  const FORMAT_OPTIONS = [
    "DD.MM.YYYY",
    "MM/DD/YYYY",
    "YYYY-MM-DD",
    "DD-MM-YYYY",
    "DD/MM/YYYY",
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Date Format</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Set the date display format used across the application and in
          generated PDFs.
        </p>
        <div className="flex items-end gap-3">
          <div>
            <label className="text-xs text-muted-foreground mb-1.5 block">
              Format
            </label>
            <Select value={dateFormat} onValueChange={setDateFormat}>
              <SelectTrigger className="w-44">
                <SelectValue placeholder="Select format" />
              </SelectTrigger>
              <SelectContent>
                {FORMAT_OPTIONS.map((f) => (
                  <SelectItem key={f} value={f}>
                    {f}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button
            size="sm"
            onClick={() => saveMutation.mutate()}
            disabled={saveMutation.isPending || !dateFormat}
          >
            {saveMutation.isPending && <Spinner size="sm" className="mr-1 text-current" />}
            {saveMutation.isPending ? "Saving…" : "Save"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function RevisionSuffixCard() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Document Filename Format</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Generated PDF filenames follow a fixed pattern combining the reference
          number and zero-padded revision number.
        </p>
        <div className="rounded-md bg-muted px-4 py-3 font-mono text-sm">
          {"<reference_no>_<revision:02d>.pdf"}
        </div>
        <div className="space-y-1 text-sm text-muted-foreground">
          <p>
            Revision 0 (initial):{" "}
            <code className="text-xs bg-muted px-1 rounded">
              MERC-JMJV-EL-WIR-0031_00.pdf
            </code>
          </p>
          <p>
            Revision 1:{" "}
            <code className="text-xs bg-muted px-1 rounded">
              MERC-JMJV-EL-WIR-0031_01.pdf
            </code>
          </p>
          <p>
            Revision 2:{" "}
            <code className="text-xs bg-muted px-1 rounded">
              MERC-JMJV-EL-WIR-0031_02.pdf
            </code>
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

function AssetCustomFieldsCard() {
  const qc = useQueryClient();
  const [fields, setFields] = useState<{ id: string; label: string }[]>([]);
  const [loaded, setLoaded] = useState(false);

  const { data } = useQuery<{ key: string; value: string }>({
    queryKey: ["app-setting", "asset_custom_fields"],
    queryFn: async () =>
      (await api.get("/admin/settings/asset_custom_fields")).data,
  });

  if (data && !loaded) {
    try {
      setFields(JSON.parse(data.value));
    } catch {
      setFields([]);
    }
    setLoaded(true);
  }

  const saveMutation = useMutation({
    mutationFn: () =>
      api.put("/admin/settings/asset_custom_fields", {
        value: JSON.stringify(fields),
      }),
    onSuccess: () => {
      toast.success("Custom fields saved");
      qc.invalidateQueries({
        queryKey: ["app-setting", "asset_custom_fields"],
      });
    },
  });

  const addField = () => {
    const nextId = `field_${Date.now()}`;
    setFields([...fields, { id: nextId, label: "" }]);
  };

  const removeField = (id: string) =>
    setFields(fields.filter((f) => f.id !== id));
  const updateLabel = (id: string, label: string) =>
    setFields(fields.map((f) => (f.id === id ? { ...f, label } : f)));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Asset Custom Fields</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Define custom fields that appear on every asset. You can add, rename,
          or remove fields.
        </p>
        <div className="space-y-2">
          {fields.map((f) => (
            <div key={f.id} className="flex items-center gap-2">
              <Input
                value={f.label}
                onChange={(e) => updateLabel(f.id, e.target.value)}
                placeholder="Field label"
                className="flex-1"
              />
              <Button
                variant="ghost"
                size="sm"
                className="text-destructive hover:text-destructive"
                onClick={() => removeField(f.id)}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={addField}>
            Add Field
          </Button>
          <Button
            size="sm"
            onClick={() => saveMutation.mutate()}
            disabled={
              saveMutation.isPending || fields.some((f) => !f.label.trim())
            }
          >
            {saveMutation.isPending && <Spinner size="sm" className="mr-1 text-current" />}
            {saveMutation.isPending ? "Saving…" : "Save"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function SignatureConfigCard() {
  const qc = useQueryClient();
  const [docType, setDocType] = useState("WIR");
  const [config, setConfig] = useState<
    Record<
      string,
      { font_size: number; cell_width: number; x_offset: number; color: string }
    >
  >({});
  const [loaded, setLoaded] = useState(false);

  const defaultCfg = {
    font_size: 36,
    cell_width: 75,
    x_offset: -0.3,
    color: "#1a237e",
  };

  const { data } = useQuery<{ key: string; value: string }>({
    queryKey: ["app-setting", "signature_config"],
    queryFn: async () =>
      (await api.get("/admin/settings/signature_config")).data,
  });

  useEffect(() => {
    if (data && !loaded) {
      try {
        setConfig(JSON.parse(data.value));
      } catch {}
      setLoaded(true);
    }
  }, [data, loaded]);

  // Ensure current doc type has config (handles new doc types automatically)
  const current = config[docType] || defaultCfg;

  const updateField = (field: string, value: number | string) => {
    setConfig((prev) => ({
      ...prev,
      [docType]: { ...current, [field]: value },
    }));
  };

  const save = useMutation({
    mutationFn: async () => {
      // Ensure all doc types have entries before saving
      const toSave = { ...config };
      if (!toSave[docType]) toSave[docType] = current;
      await api.put("/admin/settings/signature_config", {
        value: JSON.stringify(toSave),
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["app-setting", "signature_config"] });
      toast.success("Saved");
    },
  });

  const docTypes =
    Object.keys(config).length > 0
      ? [...new Set(["WIR", "MIR", "CIR", "FAT", ...Object.keys(config)])]
      : ["WIR", "MIR", "CIR", "FAT"];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">PDF Signature Settings</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Configure signature rendering per document type in generated PDFs.
          These settings only affect PDF output (always white background).
        </p>

        <div>
          <label className="text-xs text-muted-foreground mb-1.5 block">
            Document Type
          </label>
          <Select
            value={docType}
            onValueChange={(v) => setDocType(v as string)}
          >
            <SelectTrigger className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {docTypes.map((dt) => (
                <SelectItem key={dt} value={dt}>
                  {dt}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="text-xs text-muted-foreground mb-1.5 block">
              Font Size (pt)
            </label>
            <Input
              type="number"
              value={current.font_size}
              onChange={(e) => updateField("font_size", Number(e.target.value))}
            />
            <p className="text-[10px] text-muted-foreground mt-1">
              Starting font size before scaling to fit cell
            </p>
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1.5 block">
              Cell Width (pt)
            </label>
            <Input
              type="number"
              value={current.cell_width}
              onChange={(e) =>
                updateField("cell_width", Number(e.target.value))
              }
            />
            <p className="text-[10px] text-muted-foreground mt-1">
              Max width the signature can occupy (1 inch = 72pt)
            </p>
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1.5 block">
              X Offset (multiplier)
            </label>
            <Input
              type="number"
              step="0.1"
              value={current.x_offset}
              onChange={(e) => updateField("x_offset", Number(e.target.value))}
            />
            <p className="text-[10px] text-muted-foreground mt-1">
              Horizontal shift relative to marker width (negative = left)
            </p>
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1.5 block">
              Signature Color
            </label>
            <div className="flex items-center gap-2">
              <div className="relative">
                <input
                  type="color"
                  value={current.color}
                  onChange={(e) => updateField("color", e.target.value)}
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                />
                <div
                  className="h-9 w-9 rounded-md border"
                  style={{ backgroundColor: current.color }}
                />
              </div>
              <Input
                type="text"
                value={current.color}
                onChange={(e) => updateField("color", e.target.value)}
                className="flex-1 font-mono text-xs"
                placeholder="#1a237e"
              />
            </div>
            <p className="text-[10px] text-muted-foreground mt-1">
              Color on PDF (white background) - click swatch to pick
            </p>
          </div>
        </div>

        <Button
          onClick={() => save.mutate()}
          disabled={save.isPending}
          size="sm"
        >
          {save.isPending && <Spinner size="sm" className="mr-1 text-current" />}
          {save.isPending ? "Saving…" : "Save"}
        </Button>
      </CardContent>
    </Card>
  );
}

function CrsHeaderCard() {
  const project = useSelectedProject();
  const [preview, setPreview] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  // Load existing header
  useEffect(() => {
    if (!project?.id) return;
    api
      .get(`/admin/settings/crs-header/${project.id}`)
      .then((res) => {
        if (res.data?.exists && res.data.data) {
          setPreview(`data:image/png;base64,${res.data.data}`);
        }
      })
      .catch(() => {});
  }, [project?.id]);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !project?.id) return;
    if (!file.type.startsWith("image/")) {
      toast.error("Please select an image file");
      e.target.value = "";
      return;
    }
    if (file.size > MAX_HEADER_IMAGE_BYTES) {
      toast.error(
        `Image must be under ${formatSizeCap(MAX_HEADER_IMAGE_BYTES)} (was ${(file.size / 1024 / 1024).toFixed(1)}MB)`,
      );
      e.target.value = "";
      return;
    }
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      await api.post(`/admin/settings/crs-header/${project.id}`, form);
      toast.success("Header image uploaded");
      const reader = new FileReader();
      reader.onload = () => setPreview(reader.result as string);
      reader.readAsDataURL(file);
    } catch {
      toast.error("Upload failed");
    } finally {
      setUploading(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">CRS Header Image</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Upload a PNG header image for CRS PDF reports. This image will appear
          at the top of every generated CRS document for this project.
        </p>
        {preview && (
          <div className="rounded-md border p-2 bg-white">
            <Image
              src={preview}
              alt="CRS Header"
              width={300}
              height={100}
              unoptimized
              className="max-h-24 w-auto"
            />
          </div>
        )}
        <div>
          <input
            type="file"
            accept="image/png,image/jpeg"
            onChange={handleUpload}
            className="block text-sm text-foreground file:mr-2 file:py-1.5 file:px-3 file:rounded-md file:border file:border-border file:text-sm file:font-medium file:bg-background file:text-foreground hover:file:bg-accent cursor-pointer"
          />
          <p className="text-xs text-muted-foreground mt-1">
            Accepted: PNG or JPEG, max {formatSizeCap(MAX_HEADER_IMAGE_BYTES)}. Will be scaled to fit A4 width.
          </p>
        </div>
        {uploading && (
          <p className="text-sm text-muted-foreground inline-flex items-center gap-2">
            <Spinner size="sm" />
            Uploading…
          </p>
        )}
      </CardContent>
    </Card>
  );
}
