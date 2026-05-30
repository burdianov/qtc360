"use client";

import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import api from "@/lib/api";
import { toast } from "sonner";
import { useSelectedProject } from "@/hooks/use-project";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs } from "@/components/ui/tabs";
import { Trash2 } from "lucide-react";
import { ProjectApproversCard } from "./project-approvers-card";

interface RefConfig {
  id: string;
  project_id: string;
  doc_type: string;
  pattern: string;
  project_code: string;
  contractor_code: string;
  serial_start: number;
}

export default function SettingsPage() {
  const qc = useQueryClient();
  const project = useSelectedProject();
  const projectId = project?.id;

  const [docType, setDocType] = useState("WIR");
  const [projectCode, setProjectCode] = useState("");
  const [contractorCode, setContractorCode] = useState("");
  const [pattern, setPattern] = useState("{project_code}-{contractor_code}-{discipline_code}-{doc_type}-{serial:04d}");
  const [serialStart, setSerialStart] = useState(1);

  const { data: configs = [] } = useQuery<RefConfig[]>({
    queryKey: ["ref-configs", projectId],
    queryFn: async () => (await api.get("/ref-config", { params: { project_id: projectId } })).data,
    enabled: !!projectId,
  });

  const saveMutation = useMutation({
    mutationFn: () => api.post("/ref-config", {
      project_id: projectId,
      doc_type: docType,
      pattern,
      project_code: projectCode,
      contractor_code: contractorCode,
      serial_start: serialStart,
    }),
    onSuccess: () => {
      toast.success("Reference number config saved");
      qc.invalidateQueries({ queryKey: ["ref-configs", projectId] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/ref-config/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["ref-configs", projectId] }),
  });

  const existing = configs.find((c) => c.doc_type === docType);
  const loadExisting = () => {
    if (existing) {
      setProjectCode(existing.project_code);
      setContractorCode(existing.contractor_code);
      setPattern(existing.pattern);
      setSerialStart(existing.serial_start);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground">Project configuration and preferences</p>
      </div>

      <Tabs tabs={[
        {
          id: "reference",
          label: "Reference Numbers",
          content: (
            <Card>
              <CardHeader><CardTitle className="text-base">Reference Number Configuration</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Configure how document reference numbers are generated. Example: <code className="text-xs bg-muted px-1 py-0.5 rounded">MERC-JMJV-EL-WIR-0031</code>
          </p>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="text-xs text-muted-foreground mb-1.5 block">Document Type</label>
              <Select value={docType} onValueChange={(v) => { setDocType(v as string); }}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="WIR">WIR</SelectItem>
                  <SelectItem value="MIR">MIR</SelectItem>
                  <SelectItem value="CIR">CIR</SelectItem>
                  <SelectItem value="FAT">FAT</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1.5 block">Project Code (e.g. MERC)</label>
              <Input value={projectCode} onChange={(e) => setProjectCode(e.target.value)} placeholder="MERC" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1.5 block">Contractor Code (e.g. JMJV)</label>
              <Input value={contractorCode} onChange={(e) => setContractorCode(e.target.value)} placeholder="JMJV" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1.5 block">Serial Start</label>
              <Input type="number" value={serialStart} onChange={(e) => setSerialStart(Number(e.target.value))} />
            </div>
            <div className="sm:col-span-2">
              <label className="text-xs text-muted-foreground mb-1.5 block">Pattern</label>
              <Input value={pattern} onChange={(e) => setPattern(e.target.value)} placeholder="{project_code}-{contractor_code}-{discipline_code}-{doc_type}-{serial:04d}" />
              <p className="text-xs text-muted-foreground mt-1">
                Variables: {"{project_code}"}, {"{contractor_code}"}, {"{discipline_code}"}, {"{doc_type}"}, {"{serial:04d}"}
              </p>
            </div>
          </div>

          <div className="flex gap-2">
            {existing && <Button variant="outline" size="sm" onClick={loadExisting}>Load Existing</Button>}
            <Button size="sm" onClick={() => saveMutation.mutate()} disabled={!projectCode || saveMutation.isPending}>
              {saveMutation.isPending ? "Saving..." : existing ? "Update Config" : "Save Config"}
            </Button>
          </div>

          {configs.length > 0 && (
            <div className="border rounded-lg divide-y mt-4">
              {configs.map((c) => (
                <div key={c.id} className="flex items-center justify-between px-4 py-2 text-sm">
                  <div>
                    <span className="font-medium">{c.doc_type}</span>
                    <span className="text-muted-foreground ml-2">{c.project_code}-{c.contractor_code}-[disc]-{c.doc_type}-{String(c.serial_start).padStart(4, "0")}</span>
                  </div>
                  <Button variant="ghost" size="sm" className="text-destructive" onClick={() => deleteMutation.mutate(c.id)}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
          ),
        },
        {
          id: "approvers",
          label: "Approvers",
          content: <ProjectApproversCard projectId={projectId} />,
        },
        {
          id: "general",
          label: "General",
          content: <><DateFormatCard /><div className="mt-4"><RevisionSuffixCard /></div><div className="mt-4"><AssetCustomFieldsCard /></div></>,
        },
        {
          id: "signatures",
          label: "Signatures",
          content: <SignatureConfigCard />,
        },
      ]} />
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
    mutationFn: () => api.put("/admin/settings/date_format", { value: dateFormat }),
    onSuccess: () => {
      toast.success("Date format saved");
      qc.invalidateQueries({ queryKey: ["app-setting", "date_format"] });
    },
  });

  const FORMAT_OPTIONS = ["DD.MM.YYYY", "MM/DD/YYYY", "YYYY-MM-DD", "DD-MM-YYYY", "DD/MM/YYYY"];

  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Date Format</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Set the date display format used across the application and in generated PDFs.
        </p>
        <div className="flex items-end gap-3">
          <div>
            <label className="text-xs text-muted-foreground mb-1.5 block">Format</label>
            <Select value={dateFormat} onValueChange={setDateFormat}>
              <SelectTrigger className="w-44"><SelectValue placeholder="Select format" /></SelectTrigger>
              <SelectContent>
                {FORMAT_OPTIONS.map((f) => <SelectItem key={f} value={f}>{f}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <Button size="sm" onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending || !dateFormat}>
            {saveMutation.isPending ? "Saving..." : "Save"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function RevisionSuffixCard() {
  const qc = useQueryClient();
  const [format, setFormat] = useState("");
  const [loaded, setLoaded] = useState(false);

  const { data } = useQuery<{ key: string; value: string }>({
    queryKey: ["app-setting", "revision_suffix_format"],
    queryFn: async () => (await api.get("/admin/settings/revision_suffix_format")).data,
  });

  if (data && !loaded) {
    setFormat(data.value);
    setLoaded(true);
  }

  const saveMutation = useMutation({
    mutationFn: () => api.put("/admin/settings/revision_suffix_format", { value: format }),
    onSuccess: () => {
      toast.success("Revision suffix format saved");
      qc.invalidateQueries({ queryKey: ["app-setting", "revision_suffix_format"] });
    },
  });

  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Revision Suffix Format</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Format for document filenames when revision &gt; 0. Use <code className="text-xs bg-muted px-1 rounded">{"{ref}"}</code> for reference number and <code className="text-xs bg-muted px-1 rounded">{"{rev}"}</code> for revision number.
        </p>
        <div className="flex items-end gap-3">
          <div>
            <label className="text-xs text-muted-foreground mb-1.5 block">Format</label>
            <Input value={format} onChange={(e) => setFormat(e.target.value)} placeholder="{ref}-REV-{rev}" className="w-64 font-mono text-sm" />
          </div>
          <Button size="sm" onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending || !format}>
            {saveMutation.isPending ? "Saving..." : "Save"}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">Example: <span className="font-mono">MERC-JMJV-EL-WIR-0031-REV-1.pdf</span></p>
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
    queryFn: async () => (await api.get("/admin/settings/asset_custom_fields")).data,
  });

  if (data && !loaded) {
    try { setFields(JSON.parse(data.value)); } catch { setFields([]); }
    setLoaded(true);
  }

  const saveMutation = useMutation({
    mutationFn: () => api.put("/admin/settings/asset_custom_fields", { value: JSON.stringify(fields) }),
    onSuccess: () => {
      toast.success("Custom fields saved");
      qc.invalidateQueries({ queryKey: ["app-setting", "asset_custom_fields"] });
    },
  });

  const addField = () => {
    const nextId = `field_${Date.now()}`;
    setFields([...fields, { id: nextId, label: "" }]);
  };

  const removeField = (id: string) => setFields(fields.filter((f) => f.id !== id));
  const updateLabel = (id: string, label: string) => setFields(fields.map((f) => f.id === id ? { ...f, label } : f));

  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Asset Custom Fields</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Define custom fields that appear on every asset. You can add, rename, or remove fields.
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
              <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={() => removeField(f.id)}>
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={addField}>Add Field</Button>
          <Button size="sm" onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending || fields.some((f) => !f.label.trim())}>
            {saveMutation.isPending ? "Saving..." : "Save"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function SignatureConfigCard() {
  const qc = useQueryClient();
  const [docType, setDocType] = useState("WIR");
  const [config, setConfig] = useState<Record<string, { font_size: number; cell_width: number; x_offset: number; color: string }>>({});
  const [loaded, setLoaded] = useState(false);

  const defaultCfg = { font_size: 36, cell_width: 75, x_offset: -0.3, color: "#1a237e" };

  const { data } = useQuery<{ key: string; value: string }>({
    queryKey: ["app-setting", "signature_config"],
    queryFn: async () => (await api.get("/admin/settings/signature_config")).data,
  });

  useEffect(() => {
    if (data && !loaded) {
      try { setConfig(JSON.parse(data.value)); } catch {}
      setLoaded(true);
    }
  }, [data, loaded]);

  // Ensure current doc type has config (handles new doc types automatically)
  const current = config[docType] || defaultCfg;

  const updateField = (field: string, value: number | string) => {
    setConfig((prev) => ({ ...prev, [docType]: { ...current, [field]: value } }));
  };

  const save = useMutation({
    mutationFn: async () => {
      // Ensure all doc types have entries before saving
      const toSave = { ...config };
      if (!toSave[docType]) toSave[docType] = current;
      await api.put("/admin/settings/signature_config", { value: JSON.stringify(toSave) });
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["app-setting", "signature_config"] }); toast.success("Saved"); },
  });

  const docTypes = Object.keys(config).length > 0
    ? [...new Set(["WIR", "MIR", "CIR", "FAT", ...Object.keys(config)])]
    : ["WIR", "MIR", "CIR", "FAT"];

  return (
    <Card>
      <CardHeader><CardTitle className="text-base">PDF Signature Settings</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">Configure signature rendering per document type in generated PDFs. These settings only affect PDF output (always white background).</p>

        <div>
          <label className="text-xs text-muted-foreground mb-1.5 block">Document Type</label>
          <Select value={docType} onValueChange={(v) => setDocType(v as string)}>
            <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
            <SelectContent>
              {docTypes.map((dt) => <SelectItem key={dt} value={dt}>{dt}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="text-xs text-muted-foreground mb-1.5 block">Font Size (pt)</label>
            <Input type="number" value={current.font_size} onChange={(e) => updateField("font_size", Number(e.target.value))} />
            <p className="text-[10px] text-muted-foreground mt-1">Starting font size before scaling to fit cell</p>
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1.5 block">Cell Width (pt)</label>
            <Input type="number" value={current.cell_width} onChange={(e) => updateField("cell_width", Number(e.target.value))} />
            <p className="text-[10px] text-muted-foreground mt-1">Max width the signature can occupy (1 inch = 72pt)</p>
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1.5 block">X Offset (multiplier)</label>
            <Input type="number" step="0.1" value={current.x_offset} onChange={(e) => updateField("x_offset", Number(e.target.value))} />
            <p className="text-[10px] text-muted-foreground mt-1">Horizontal shift relative to marker width (negative = left)</p>
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1.5 block">Signature Color</label>
            <div className="flex items-center gap-2">
              <div className="relative">
                <input
                  type="color"
                  value={current.color}
                  onChange={(e) => updateField("color", e.target.value)}
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                />
                <div className="h-9 w-9 rounded-md border" style={{ backgroundColor: current.color }} />
              </div>
              <Input
                type="text"
                value={current.color}
                onChange={(e) => updateField("color", e.target.value)}
                className="flex-1 font-mono text-xs"
                placeholder="#1a237e"
              />
            </div>
            <p className="text-[10px] text-muted-foreground mt-1">Color on PDF (white background) - click swatch to pick</p>
          </div>
        </div>

        <Button onClick={() => save.mutate()} disabled={save.isPending} size="sm">
          {save.isPending ? "Saving..." : "Save"}
        </Button>
      </CardContent>
    </Card>
  );
}
