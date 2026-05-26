"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  Plus,
  Trash2,
  GripVertical,
  ChevronDown,
  ChevronRight,
  Settings2,
  Type,
  Database,
  Eye,
  Upload,
  X,
  Check,
} from "lucide-react";
import api from "@/lib/api";
import { toast } from "sonner";
import { useSelectedProject } from "@/hooks/use-project";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from "@/components/ui/tooltip";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";

// --- Types ---

interface HeaderCell {
  id: string;
  width: number;
  scale: number; // 0-100, percentage of cell to fill
}

interface HeaderRow {
  id: string;
  height: number;
  internalBorders: boolean;
  cells: HeaderCell[];
}

interface Cell {
  id: string;
  width: number;
  type: "label" | "data";
  variant: "text" | "checkbox";
  value: string;
  fieldKey: string;
  checkboxLabel: string;
}

interface Row {
  id: string;
  height: number;
  evenCells: boolean;
  isTitle: boolean;
  titleColor: string;
  bgColor: string;
  font: string;
  fontSize: number;
  expandToFooter: boolean;
  internalBorders: boolean;
  cells: Cell[];
}

interface Section {
  id: string;
  label: string;
  gap: number;
  rows: Row[];
  collapsed?: boolean;
}

interface TemplateSchema {
  margins: { top: number; right: number; bottom: number; left: number };
  font: string;
  fontSize: number;
  header: { rows: HeaderRow[] };
  footer: { sections: Section[] };
  sections: Section[];
}

// --- Helpers ---

const uid = () => crypto.randomUUID().slice(0, 8);

const defaultHeaderCell = (): HeaderCell => ({ id: uid(), width: 25, scale: 100 });

const defaultHeaderRow = (): HeaderRow => ({
  id: uid(),
  height: 60,
  internalBorders: true,
  cells: [defaultHeaderCell(), defaultHeaderCell(), defaultHeaderCell(), defaultHeaderCell()],
});

const defaultCell = (): Cell => ({
  id: uid(),
  width: 50,
  type: "label",
  variant: "text",
  value: "",
  fieldKey: "",
  checkboxLabel: "",
});

const defaultRow = (): Row => ({
  id: uid(),
  height: 25,
  evenCells: true,
  isTitle: false,
  titleColor: "#1e3a5f",
  bgColor: "",
  font: "",
  fontSize: 0,
  expandToFooter: false,
  internalBorders: true,
  cells: [defaultCell(), defaultCell()],
});

const defaultSection = (label = "New Section"): Section => ({
  id: uid(),
  label,
  gap: 5,
  rows: [defaultRow()],
});

const defaultSchema = (): TemplateSchema => ({
  margins: { top: 20, right: 15, bottom: 20, left: 15 },
  font: "Arial",
  fontSize: 10,
  header: { rows: [defaultHeaderRow()] },
  footer: { sections: [defaultSection("Footer")] },
  sections: [defaultSection("Section 1")],
});

// --- Field keys for data binding ---
const FIELD_KEYS = [
  { key: "reference_number", label: "Reference Number" },
  { key: "revision", label: "Revision" },
  { key: "project_number", label: "Project Number" },
  { key: "date", label: "Date" },
  { key: "subject", label: "Subject" },
  { key: "discipline", label: "Discipline" },
  { key: "description", label: "Description" },
  { key: "general_location", label: "General Location" },
  { key: "floor_level_room", label: "Floor / Level / Room" },
  { key: "approved_rams", label: "Approved RAMS" },
  { key: "drawing_reference", label: "Drawing Reference" },
  { key: "inspector_1_name", label: "Inspector 1 Name" },
  { key: "inspector_1_designation", label: "Inspector 1 Designation" },
  { key: "inspector_1_signature", label: "Inspector 1 Signature" },
  { key: "inspector_2_name", label: "Inspector 2 Name" },
  { key: "inspector_2_designation", label: "Inspector 2 Designation" },
  { key: "inspector_2_signature", label: "Inspector 2 Signature" },
  { key: "page_number", label: "Page Number" },
];

// --- Components ---

// --- Color Picker ---

const PRESET_COLORS = [
  "#000000", "#1a1a1a", "#2b2b2b", "#3d3d3d", "#4d4d4d", "#5c5c5c", "#6b6b6b",
  "#7a7a7a", "#8a8a8a", "#999999", "#a8a8a8", "#b8b8b8", "#c7c7c7", "#d6d6d6",
  "#e0e0e0", "#e8e8e8", "#f0f0f0", "#f5f5f5", "#f8f8f8", "#fafafa", "#ffffff",
];

function ColorPicker({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger className="flex items-center gap-1 cursor-pointer" onClick={() => setOpen(true)}>
        <div className="h-5 w-5 rounded border border-border" style={{ background: value || "transparent" }} />
      </PopoverTrigger>
      <PopoverContent side="bottom" align="start" className="w-44 p-2">
        <div className="grid grid-cols-7 gap-1 mb-2">
          {PRESET_COLORS.map((c) => (
            <button key={c} type="button" onClick={() => onChange(c)} className={`h-6 w-6 rounded border border-border hover:scale-110 transition-transform flex items-center justify-center ${value === c ? "ring-2 ring-primary" : ""}`} style={{ background: c }}>
              {value === c && <Check className="h-3 w-3" style={{ color: c >= "#999999" ? "#000" : "#fff" }} />}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <input type="color" value={value || "#ffffff"} onChange={(e) => onChange(e.target.value)} className="h-6 w-6 rounded border-0 cursor-pointer p-0" />
          <span className="text-xs text-muted-foreground flex-1">{value || "None"}</span>
          {value && <button type="button" onClick={() => onChange("")} className="text-muted-foreground hover:text-destructive"><X className="h-3 w-3" /></button>}
          <button type="button" onClick={() => setOpen(false)} className="h-5 w-5 rounded bg-primary text-primary-foreground flex items-center justify-center hover:bg-primary/90">
            <Check className="h-3 w-3" />
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function RowEditor({ row, onChange, onRemove }: { row: Row; onChange: (r: Row) => void; onRemove: () => void }) {
  const updateCell = (idx: number, cell: Cell) => {
    const cells = [...row.cells];
    cells[idx] = cell;
    onChange({ ...row, cells });
  };
  const removeCell = (idx: number) => {
    const remaining = row.cells.filter((_, i) => i !== idx);
    const w = Math.round(100 / remaining.length);
    onChange({ ...row, cells: remaining.map((c) => ({ ...c, width: w })) });
  };
  const addCell = () => {
    const count = row.cells.length + 1;
    const w = Math.floor(100 / count);
    const remainder = 100 - w * count;
    const cells = [...row.cells.map((c) => ({ ...c, width: w })), { ...defaultCell(), width: w + remainder }];
    onChange({ ...row, cells });
  };
  const containerRef = useRef<HTMLDivElement>(null);

  const handleMouseDown = (dividerIndex: number) => (e: React.MouseEvent) => {
    e.preventDefault();
    const container = containerRef.current;
    if (!container) return;
    const containerRect = container.getBoundingClientRect();
    const totalWidth = containerRect.width;
    const initialCells = row.cells.map((c) => ({ ...c }));
    const sumBefore = initialCells.slice(0, dividerIndex).reduce((a, b) => a + b.width, 0);
    const combined = initialCells[dividerIndex].width + initialCells[dividerIndex + 1].width;

    const handleMouseMove = (ev: MouseEvent) => {
      const x = ev.clientX - containerRect.left;
      const pct = (x / totalWidth) * 100;
      const newLeft = Math.round(Math.max(5, Math.min(combined - 5, pct - sumBefore)));
      const newRight = combined - newLeft;
      const cells = initialCells.map((c, i) => {
        if (i === dividerIndex) return { ...c, width: newLeft };
        if (i === dividerIndex + 1) return { ...c, width: newRight };
        return c;
      });
      onChange({ ...row, cells });
    };
    const handleMouseUp = () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
  };

  return (
    <div className={`rounded-md border p-3 space-y-2 ${row.isTitle ? "border-l-4" : "border-border"}`} style={row.isTitle ? { borderLeftColor: row.titleColor } : undefined}>
      <div className="flex items-center gap-2 flex-wrap">
        <GripVertical className="h-4 w-4 text-muted-foreground cursor-grab shrink-0" />
        <div className="flex items-center gap-1">
          <label className="text-xs text-muted-foreground">Row Height:</label>
          <Input type="number" value={row.height} onChange={(e) => onChange({ ...row, height: Number(e.target.value) })} className="h-6 w-16 text-xs" />
        </div>
        <label className="flex items-center gap-1 text-xs">
          <Checkbox checked={row.isTitle} onCheckedChange={(v) => onChange({ ...row, isTitle: !!v })} />
          Title
        </label>
        {row.isTitle && (
          <input type="color" value={row.titleColor} onChange={(e) => onChange({ ...row, titleColor: e.target.value })} className="h-6 w-6 rounded border border-border cursor-pointer" />
        )}
        <label className="flex items-center gap-1 text-xs">
          <Checkbox checked={row.expandToFooter} onCheckedChange={(v) => onChange({ ...row, expandToFooter: !!v })} />
          Expand↓
        </label>
        <label className="flex items-center gap-1 text-xs">
          <Checkbox checked={row.internalBorders ?? true} onCheckedChange={(v) => onChange({ ...row, internalBorders: !!v })} />
          Internal Borders
        </label>
        <div className="flex items-center gap-1 ml-4">
          <label className="text-xs text-muted-foreground">Row Background:</label>
          <ColorPicker value={row.bgColor} onChange={(c) => onChange({ ...row, bgColor: c })} />
        </div>
        <div className="ml-auto flex items-center gap-1">
          <Button type="button" variant="outline" size="sm" className="h-6 px-2 text-xs" onClick={() => {
            const w = Math.floor(100 / row.cells.length);
            const remainder = 100 - w * row.cells.length;
            onChange({ ...row, cells: row.cells.map((c, i) => ({ ...c, width: i === row.cells.length - 1 ? w + remainder : w })) });
          }}>Reset Widths</Button>
          <Button type="button" variant="ghost" size="sm" className="h-6 px-1" onClick={addCell}><Plus className="h-3 w-3" /></Button>
          <Button type="button" variant="ghost" size="sm" className="h-6 px-1 text-destructive" onClick={onRemove}><Trash2 className="h-3 w-3" /></Button>
        </div>
      </div>
      <div className="flex border border-border rounded-md overflow-hidden" ref={containerRef}>
        {row.cells.map((cell, ci) => (
          <div key={cell.id} className="relative min-w-0" style={{ width: `${cell.width}%` }}>
            <div className="p-2 space-y-2 bg-background h-full">
              <div className="flex items-center justify-between gap-1">
                <div className="flex items-center gap-1">
                  {cell.type === "label" ? <Type className="h-3 w-3 text-muted-foreground" /> : <Database className="h-3 w-3 text-blue-400" />}
                  <span className="text-[10px] text-muted-foreground">{Math.round(cell.width)}%</span>
                </div>
                <button onClick={() => removeCell(ci)} className="text-muted-foreground hover:text-destructive">
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
              <div className="grid grid-cols-2 gap-1">
                <Select value={cell.type} onValueChange={(v) => updateCell(ci, { ...cell, type: v as "label" | "data" })}>
                  <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="label">Label</SelectItem>
                    <SelectItem value="data">Data</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={cell.variant} onValueChange={(v) => updateCell(ci, { ...cell, variant: v as "text" | "checkbox" })}>
                  <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="text">Text</SelectItem>
                    <SelectItem value="checkbox">Checkbox</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {cell.type === "label" && cell.variant === "text" && (
                <Input value={cell.value} onChange={(e) => updateCell(ci, { ...cell, value: e.target.value })} placeholder="Label text" className="h-7 text-xs" />
              )}
              {cell.type === "label" && cell.variant === "checkbox" && (
                <Input value={cell.checkboxLabel} onChange={(e) => updateCell(ci, { ...cell, checkboxLabel: e.target.value })} placeholder="Checkbox label" className="h-7 text-xs" />
              )}
              {cell.type === "data" && (
                <Select value={cell.fieldKey} onValueChange={(v) => updateCell(ci, { ...cell, fieldKey: v as string })}>
                  <SelectTrigger className="h-7 text-xs"><SelectValue placeholder="Bind to field..." /></SelectTrigger>
                  <SelectContent>
                    {FIELD_KEYS.map((f) => <SelectItem key={f.key} value={f.key}>{f.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              )}
            </div>
            {ci < row.cells.length - 1 && (
              <div
                className="absolute top-0 right-0 w-[3px] h-full cursor-col-resize z-10 translate-x-1/2 bg-border hover:bg-primary transition-colors"
                onMouseDown={handleMouseDown(ci)}
              />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function SectionEditor({ section, onChange, onRemove }: { section: Section; onChange: (s: Section) => void; onRemove: () => void }) {
  const [collapsed, setCollapsed] = useState(false);
  const updateRow = (idx: number, row: Row) => {
    const rows = [...section.rows];
    rows[idx] = row;
    onChange({ ...section, rows });
  };
  const removeRow = (idx: number) => onChange({ ...section, rows: section.rows.filter((_, i) => i !== idx) });
  const addRow = () => onChange({ ...section, rows: [...section.rows, defaultRow()] });

  return (
    <Card>
      <CardHeader className="flex flex-row items-center gap-2 py-3 cursor-pointer" onClick={() => setCollapsed(!collapsed)}>
        {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        <Input
          value={section.label}
          onChange={(e) => { e.stopPropagation(); onChange({ ...section, label: e.target.value }); }}
          onClick={(e) => e.stopPropagation()}
          className="h-7 text-sm font-medium flex-1"
        />
        <div className="flex items-center gap-1">
          <label className="text-xs text-muted-foreground">Gap:</label>
          <Input type="number" value={section.gap} onChange={(e) => { e.stopPropagation(); onChange({ ...section, gap: Number(e.target.value) }); }} onClick={(e) => e.stopPropagation()} className="h-6 w-16 text-xs" />
        </div>
        <Button type="button" variant="ghost" size="sm" className="h-7 text-destructive" onClick={(e) => { e.stopPropagation(); onRemove(); }}>
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </CardHeader>
      {!collapsed && (
        <CardContent className="space-y-2 pt-0">
          {section.rows.map((row, ri) => (
            <RowEditor key={row.id} row={row} onChange={(r) => updateRow(ri, r)} onRemove={() => removeRow(ri)} />
          ))}
          <Button type="button" variant="outline" size="sm" onClick={addRow} className="w-full">
            <Plus className="h-3 w-3 mr-1" />Add Row
          </Button>
        </CardContent>
      )}
    </Card>
  );
}

// --- Header Editor ---

function HeaderCellEditor({ cell, projectId, onChange, onRemove }: { cell: HeaderCell; projectId?: string; onChange: (c: HeaderCell) => void; onRemove: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [imgKey, setImgKey] = useState(0);
  const imgUrl = projectId ? `${api.defaults.baseURL}/templates/header-image/${projectId}/${cell.id}` : null;

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !projectId) return;
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      await api.post(`/templates/header-image/${projectId}/${cell.id}`, form, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      setImgKey((k) => k + 1);
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  return (
    <div className="flex-1 min-w-0 border border-border rounded-md p-1.5 space-y-1.5 bg-background overflow-hidden">
      <div className="flex items-center gap-1">
        <Input type="number" value={cell.width} onChange={(e) => onChange({ ...cell, width: Number(e.target.value) })} className="h-5 w-10 text-xs" />
        <span className="text-[10px] text-muted-foreground">%</span>
        <button onClick={onRemove} className="text-muted-foreground hover:text-destructive ml-auto">
          <Trash2 className="h-3 w-3" />
        </button>
      </div>
      {/* Image preview */}
      <div className="flex items-center justify-center h-20 border border-dashed border-border rounded overflow-hidden bg-muted/30 cursor-pointer hover:border-primary/50 transition-colors" onClick={() => fileRef.current?.click()}>
        {imgUrl && (
          <img
            key={imgKey}
            src={`${imgUrl}?t=${imgKey}`}
            alt=""
            className="max-h-full max-w-full object-contain"
            style={{ transform: `scale(${cell.scale / 100})` }}
            onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
          />
        )}
      </div>
      {/* Upload + Scale */}
      <div className="flex items-center gap-1 flex-wrap">
        <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleUpload} />
        <Button type="button" variant="outline" size="sm" className="h-5 text-[10px] px-1.5" onClick={() => fileRef.current?.click()} disabled={uploading || !projectId}>
          <Upload className="h-2.5 w-2.5 mr-0.5" />{uploading ? "..." : "Upload"}
        </Button>
        <input type="range" min={10} max={100} value={cell.scale} onChange={(e) => onChange({ ...cell, scale: Number(e.target.value) })} className="flex-1 min-w-8 h-3" />
        <span className="text-[10px] text-muted-foreground">{cell.scale}%</span>
      </div>
    </div>
  );
}

function HeaderEditor({ schema, onChange, projectId }: { schema: TemplateSchema; onChange: (s: TemplateSchema) => void; projectId?: string }) {
  const updateRow = (ri: number, row: HeaderRow) => {
    const rows = [...schema.header.rows];
    rows[ri] = row;
    onChange({ ...schema, header: { rows } });
  };
  const addRow = () => onChange({ ...schema, header: { rows: [...schema.header.rows, defaultHeaderRow()] } });
  const removeRow = (ri: number) => onChange({ ...schema, header: { rows: schema.header.rows.filter((_, i) => i !== ri) } });

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between py-3">
        <CardTitle className="text-base">Header</CardTitle>
        <Button type="button" variant="outline" size="sm" onClick={addRow}><Plus className="h-3 w-3 mr-1" />Add Row</Button>
      </CardHeader>
      <CardContent className="space-y-3">
        {schema.header.rows.map((row, ri) => (
          <div key={row.id} className="space-y-2 rounded-md border border-border p-3">
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">Row {ri + 1}</span>
              <label className="text-xs text-muted-foreground ml-2">Row Height:</label>
              <Input type="number" value={row.height} onChange={(e) => updateRow(ri, { ...row, height: Number(e.target.value) })} className="h-6 w-16 text-xs" />
              <span className="text-xs text-muted-foreground">pt</span>
              <label className="flex items-center gap-1 text-xs ml-2">
                <Checkbox checked={row.internalBorders} onCheckedChange={(v) => updateRow(ri, { ...row, internalBorders: !!v })} />
                Internal Borders
              </label>
              <Button type="button" variant="ghost" size="sm" className="h-6 px-1 ml-auto" onClick={() => updateRow(ri, { ...row, cells: [...row.cells, defaultHeaderCell()] })}><Plus className="h-3 w-3" /></Button>
              {schema.header.rows.length > 1 && (
                <Button type="button" variant="ghost" size="sm" className="h-6 px-1 text-destructive" onClick={() => removeRow(ri)}><Trash2 className="h-3 w-3" /></Button>
              )}
            </div>
            <div className="flex gap-2 overflow-hidden">
              {row.cells.map((cell, ci) => (
                <HeaderCellEditor
                  key={cell.id}
                  cell={cell}
                  projectId={projectId}
                  onChange={(c) => { const cells = [...row.cells]; cells[ci] = c; updateRow(ri, { ...row, cells }); }}
                  onRemove={() => updateRow(ri, { ...row, cells: row.cells.filter((_, i) => i !== ci) })}
                />
              ))}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

// --- Main Page ---

export default function TemplateBuilderPage() {
  const router = useRouter();
  const project = useSelectedProject();
  const queryClient = useQueryClient();
  const searchParams = useSearchParams();
  const templateId = searchParams.get("id");

  const [schema, setSchema] = useState<TemplateSchema>(defaultSchema);
  const [name, setName] = useState("WIR Template");
  const [docType, setDocType] = useState("WIR");
  const [dirty, setDirty] = useState(false);

  const updateSchema = (s: TemplateSchema) => { setSchema(s); setDirty(true); };
  const updateName = (n: string) => { setName(n); setDirty(true); };
  const updateDocType = (d: string) => { setDocType(d); setDirty(true); };

  // Load existing template
  useQuery({
    queryKey: ["template", templateId],
    queryFn: async () => {
      const res = await api.get(`/templates/${templateId}`);
      setName(res.data.name);
      setDocType(res.data.doc_type);
      if (res.data.template_schema && Object.keys(res.data.template_schema).length) {
        setSchema(res.data.template_schema);
      }
      return res.data;
    },
    enabled: !!templateId,
  });

  // Auto-save with debounce
  const templateIdRef = useRef<string | null>(templateId);
  useEffect(() => {
    if (!dirty) return;
    const timer = setTimeout(async () => {
      if (templateIdRef.current) {
        await api.patch(`/templates/${templateIdRef.current}`, { name, template_schema: schema });
      } else if (project) {
        const res = await api.post("/templates", { project_id: project.id, doc_type: docType, name, template_schema: schema });
        // Update URL with new template id so subsequent saves are patches
        const url = new URL(window.location.href);
        url.searchParams.set("id", res.data.id);
        window.history.replaceState(null, "", url.toString());
        templateIdRef.current = res.data.id;
      }
      queryClient.invalidateQueries({ queryKey: ["templates"] });
      setDirty(false);
    }, 800);
    return () => clearTimeout(timer);
  }, [dirty, schema, name, docType]);

  const updateSection = (idx: number, section: Section) => {
    const sections = [...schema.sections];
    sections[idx] = section;
    updateSchema({ ...schema, sections });
  };

  const removeSection = (idx: number) => {
    updateSchema({ ...schema, sections: schema.sections.filter((_, i) => i !== idx) });
  };

  const addSection = () => {
    updateSchema({ ...schema, sections: [...schema.sections, defaultSection(`Section ${schema.sections.length + 1}`)] });
  };

  const updateFooterSection = (idx: number, section: Section) => {
    const sections = [...schema.footer.sections];
    sections[idx] = section;
    updateSchema({ ...schema, footer: { ...schema.footer, sections } });
  };

  const handlePreview = async () => {
    const id = templateIdRef.current;
    if (!id) {
      toast.info("Save the template first by making a change before previewing.");
      return;
    }
    try {
      const res = await api.post("/pdf/generate", { template_id: id }, { responseType: "blob" });
      const url = URL.createObjectURL(res.data);
      window.open(url, "_blank");
    } catch (e) {
      console.error("PDF generation failed", e);
      toast.error("PDF generation failed.");
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="sm" onClick={() => router.push("/documents/templates")}>
          <ArrowLeft className="h-4 w-4 mr-1" />Back
        </Button>
        <div className="flex-1">
          <h1 className="text-2xl font-semibold tracking-tight">Template Builder</h1>
          <p className="text-sm text-muted-foreground">Design document cover sheet layout</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => router.push("/documents/templates")}>
          <X className="h-4 w-4 mr-1" />Close
        </Button>
      </div>

      {/* Template Settings */}
      <Card>
        <CardHeader><CardTitle className="text-base flex items-center gap-2"><Settings2 className="h-4 w-4" />Template Settings</CardTitle></CardHeader>
        <CardContent className="space-y-6">
          {/* Identity */}
          <div className="grid gap-x-12 gap-y-4 sm:grid-cols-2">
            <div className="flex items-center gap-3">
              <label className="text-sm text-muted-foreground w-28 shrink-0 text-right">Name</label>
              <Input value={name} onChange={(e) => updateName(e.target.value)} />
            </div>
            <div className="flex items-center gap-3">
              <label className="text-sm text-muted-foreground w-28 shrink-0 text-right">Font</label>
              <Select value={schema.font} onValueChange={(v) => v && updateSchema({ ...schema, font: v })}>
                <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {["Arial", "Helvetica", "Times New Roman", "Calibri", "Cambria", "Georgia", "Verdana", "Tahoma", "Trebuchet MS", "Courier New"].map((f) => (
                    <SelectItem key={f} value={f}><span style={{ fontFamily: f }}>{f}</span></SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-3">
              <label className="text-sm text-muted-foreground w-28 shrink-0 text-right">Doc Type</label>
              <Select value={docType} onValueChange={(v) => v && updateDocType(v as string)}>
                <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="WIR">WIR</SelectItem>
                  <SelectItem value="MIR">MIR</SelectItem>
                  <SelectItem value="CIR">CIR</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-3">
              <label className="text-sm text-muted-foreground w-28 shrink-0 text-right">Font Size</label>
              <Input type="number" value={schema.fontSize} onChange={(e) => updateSchema({ ...schema, fontSize: Number(e.target.value) })} className="w-20" />
              <span className="text-xs text-muted-foreground">pt</span>
            </div>
          </div>

          <Separator />

          {/* Margins */}
          <div>
            <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-4">Page Margins</h3>
            <div className="grid gap-x-12 gap-y-4 sm:grid-cols-2">
              <div className="flex items-center gap-3">
                <label className="text-sm text-muted-foreground w-28 shrink-0 text-right">Top</label>
                <Input type="number" value={schema.margins.top} onChange={(e) => updateSchema({ ...schema, margins: { ...schema.margins, top: Number(e.target.value) } })} className="w-20" />
                <span className="text-xs text-muted-foreground">pt</span>
              </div>
              <div className="flex items-center gap-3">
                <label className="text-sm text-muted-foreground w-28 shrink-0 text-right">Bottom</label>
                <Input type="number" value={schema.margins.bottom} onChange={(e) => updateSchema({ ...schema, margins: { ...schema.margins, bottom: Number(e.target.value) } })} className="w-20" />
                <span className="text-xs text-muted-foreground">pt</span>
              </div>
              <div className="flex items-center gap-3">
                <label className="text-sm text-muted-foreground w-28 shrink-0 text-right">Left</label>
                <Input type="number" value={schema.margins.left} onChange={(e) => updateSchema({ ...schema, margins: { ...schema.margins, left: Number(e.target.value) } })} className="w-20" />
                <span className="text-xs text-muted-foreground">pt</span>
              </div>
              <div className="flex items-center gap-3">
                <label className="text-sm text-muted-foreground w-28 shrink-0 text-right">Right</label>
                <Input type="number" value={schema.margins.right} onChange={(e) => updateSchema({ ...schema, margins: { ...schema.margins, right: Number(e.target.value) } })} className="w-20" />
                <span className="text-xs text-muted-foreground">pt</span>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Header */}
      <HeaderEditor schema={schema} onChange={updateSchema} projectId={project?.id} />

      {/* Sections */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Sections</h2>
          <Button variant="outline" size="sm" onClick={addSection}><Plus className="h-3 w-3 mr-1" />Add Section</Button>
        </div>
        <div className="space-y-4">
          {schema.sections.map((section, si) => (
            <SectionEditor key={section.id} section={section} onChange={(s) => updateSection(si, s)} onRemove={() => removeSection(si)} />
          ))}
        </div>
      </div>

      <Separator />

      {/* Footer */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Footer (repeats on all pages)</h2>
        </div>
        {schema.footer.sections.map((section, si) => (
          <SectionEditor key={section.id} section={section} onChange={(s) => updateFooterSection(si, s)} onRemove={() => {}} />
        ))}
      </div>

      {/* Floating action button */}
      <div className="fixed bottom-6 right-6 z-50">
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button size="icon" className="h-12 w-12 rounded-full shadow-lg bg-blue-600 hover:bg-blue-700 text-white" onClick={handlePreview}>
                <Eye className="h-5 w-5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="left">Preview</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>
    </div>
  );
}
