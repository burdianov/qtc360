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
} from "lucide-react";
import api from "@/lib/api";
import { useSelectedProject } from "@/hooks/use-project";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from "@/components/ui/tooltip";
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

function CellEditor({ cell, row, onChange, onRemove }: { cell: Cell; row: Row; onChange: (c: Cell) => void; onRemove: () => void }) {
  return (
    <div className="flex-1 min-w-0 border border-border rounded-md p-2 space-y-2 bg-background">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          {cell.type === "label" ? <Type className="h-3 w-3 text-muted-foreground" /> : <Database className="h-3 w-3 text-blue-400" />}
          <span className="text-xs text-muted-foreground">{cell.type}/{cell.variant}</span>
        </div>
        {!row.evenCells && (
          <Input
            type="number"
            value={cell.width}
            onChange={(e) => onChange({ ...cell, width: Number(e.target.value) })}
            className="h-6 w-14 text-xs"
            placeholder="%"
          />
        )}
        <button onClick={onRemove} className="text-muted-foreground hover:text-destructive">
          <Trash2 className="h-3 w-3" />
        </button>
      </div>
      <div className="grid grid-cols-2 gap-1">
        <Select value={cell.type} onValueChange={(v) => onChange({ ...cell, type: v as "label" | "data" })}>
          <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="label">Label</SelectItem>
            <SelectItem value="data">Data</SelectItem>
          </SelectContent>
        </Select>
        <Select value={cell.variant} onValueChange={(v) => onChange({ ...cell, variant: v as "text" | "checkbox" })}>
          <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="text">Text</SelectItem>
            <SelectItem value="checkbox">Checkbox</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {cell.type === "label" && cell.variant === "text" && (
        <Input value={cell.value} onChange={(e) => onChange({ ...cell, value: e.target.value })} placeholder="Label text" className="h-7 text-xs" />
      )}
      {cell.type === "label" && cell.variant === "checkbox" && (
        <Input value={cell.checkboxLabel} onChange={(e) => onChange({ ...cell, checkboxLabel: e.target.value })} placeholder="Checkbox label" className="h-7 text-xs" />
      )}
      {cell.type === "data" && (
        <Select value={cell.fieldKey} onValueChange={(v) => onChange({ ...cell, fieldKey: v as string })}>
          <SelectTrigger className="h-7 text-xs"><SelectValue placeholder="Bind to field..." /></SelectTrigger>
          <SelectContent>
            {FIELD_KEYS.map((f) => <SelectItem key={f.key} value={f.key}>{f.label}</SelectItem>)}
          </SelectContent>
        </Select>
      )}
    </div>
  );
}

function RowEditor({ row, onChange, onRemove }: { row: Row; onChange: (r: Row) => void; onRemove: () => void }) {
  const updateCell = (idx: number, cell: Cell) => {
    const cells = [...row.cells];
    cells[idx] = cell;
    onChange({ ...row, cells });
  };
  const removeCell = (idx: number) => onChange({ ...row, cells: row.cells.filter((_, i) => i !== idx) });
  const addCell = () => onChange({ ...row, cells: [...row.cells, defaultCell()] });

  return (
    <div className={`rounded-md border p-3 space-y-2 ${row.isTitle ? "border-l-4" : "border-border"}`} style={row.isTitle ? { borderLeftColor: row.titleColor } : undefined}>
      <div className="flex items-center gap-2 flex-wrap">
        <GripVertical className="h-4 w-4 text-muted-foreground cursor-grab shrink-0" />
        <div className="flex items-center gap-1">
          <label className="text-xs text-muted-foreground">H:</label>
          <Input type="number" value={row.height} onChange={(e) => onChange({ ...row, height: Number(e.target.value) })} className="h-6 w-12 text-xs" />
        </div>
        <label className="flex items-center gap-1 text-xs">
          <Checkbox checked={row.evenCells} onCheckedChange={(v) => onChange({ ...row, evenCells: !!v })} />
          Even
        </label>
        <label className="flex items-center gap-1 text-xs">
          <Checkbox checked={row.isTitle} onCheckedChange={(v) => onChange({ ...row, isTitle: !!v })} />
          Title
        </label>
        {row.isTitle && (
          <Input type="color" value={row.titleColor} onChange={(e) => onChange({ ...row, titleColor: e.target.value })} className="h-6 w-8 p-0 border-0" />
        )}
        <label className="flex items-center gap-1 text-xs">
          <Checkbox checked={row.expandToFooter} onCheckedChange={(v) => onChange({ ...row, expandToFooter: !!v })} />
          Expand↓
        </label>
        <label className="flex items-center gap-1 text-xs">
          <Checkbox checked={row.internalBorders ?? true} onCheckedChange={(v) => onChange({ ...row, internalBorders: !!v })} />
          Int. Borders
        </label>
        <div className="ml-auto flex gap-1">
          <Button type="button" variant="ghost" size="sm" className="h-6 px-1" onClick={addCell}><Plus className="h-3 w-3" /></Button>
          <Button type="button" variant="ghost" size="sm" className="h-6 px-1 text-destructive" onClick={onRemove}><Trash2 className="h-3 w-3" /></Button>
        </div>
      </div>
      <div className="flex gap-2">
        {row.cells.map((cell, ci) => (
          <CellEditor key={cell.id} cell={cell} row={row} onChange={(c) => updateCell(ci, c)} onRemove={() => removeCell(ci)} />
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
          <Input type="number" value={section.gap} onChange={(e) => { e.stopPropagation(); onChange({ ...section, gap: Number(e.target.value) }); }} onClick={(e) => e.stopPropagation()} className="h-6 w-12 text-xs" />
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
              <label className="text-xs text-muted-foreground ml-2">H:</label>
              <Input type="number" value={row.height} onChange={(e) => updateRow(ri, { ...row, height: Number(e.target.value) })} className="h-6 w-14 text-xs" />
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
  const templateIdRef = useRef(templateId);
  templateIdRef.current = templateId;
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

  const handlePreview = () => {
    const renderCells = (cells: Cell[], evenCells: boolean, internalBorders: boolean = true) =>
      cells.map((cell, i) => {
        const width = evenCells ? `${100 / cells.length}%` : `${cell.width}%`;
        let content = "";
        if (cell.type === "label" && cell.variant === "text") content = cell.value;
        else if (cell.type === "label" && cell.variant === "checkbox") content = `☐ ${cell.checkboxLabel}`;
        else if (cell.type === "data" && cell.variant === "text") content = `[${cell.fieldKey || "field"}]`;
        else if (cell.type === "data" && cell.variant === "checkbox") content = `☐ [${cell.fieldKey || "field"}]`;
        const borderStyle = internalBorders && i > 0 ? "border-left:1px solid #333;" : "";
        return `<td style="width:${width};padding:4px 6px;${borderStyle}">${content}</td>`;
      }).join("");

    const renderRows = (rows: Row[]) =>
      rows.map((row) => {
        const bg = row.isTitle ? `background:${row.titleColor};color:#fff;font-weight:bold;` : "";
        return `<tr style="height:${row.height}pt;border:1px solid #333;${bg}">${renderCells(row.cells, row.evenCells, row.internalBorders ?? true)}</tr>`;
      }).join("");

    const renderSections = (sections: Section[], startGap = 0) =>
      sections.map((section, i) => {
        const gap = i === 0 ? startGap : section.gap;
        const mt = gap === 0 ? "margin-top:-1px;" : `margin-top:${gap}pt;`;
        return `<table style="width:100%;border-collapse:collapse;${mt}border:1px solid #333;">
          ${renderRows(section.rows)}
        </table>`;
      }).join("");

    const renderHeader = () => {
      if (!project || !schema.header.rows.length) return "";
      return schema.header.rows.map((row, ri) => {
        const cellWidth = 100 / row.cells.length;
        const mt = ri > 0 ? "margin-top:-1px;" : "";
        return `<table style="width:100%;table-layout:fixed;border-collapse:collapse;height:${row.height}pt;border:1px solid #333;${mt}"><tr>${
          row.cells.map((cell, ci) =>
            `<td style="width:${cellWidth}%;text-align:center;vertical-align:middle;padding:4px;overflow:hidden;${ci > 0 && row.internalBorders ? "border-left:1px solid #333;" : ""}">
              <img src="${api.defaults.baseURL}/templates/header-image/${project.id}/${cell.id}" style="max-width:100%;max-height:${row.height - 8}pt;object-fit:contain;transform:scale(${cell.scale / 100});" onerror="this.style.display='none'" />
            </td>`
          ).join("")
        }</tr></table>`;
      }).join("");
    };

    const html = `<!DOCTYPE html><html><head><title>${name} — Preview</title>
      <style>
        @page { margin: ${schema.margins.top}pt ${schema.margins.right}pt ${schema.margins.bottom}pt ${schema.margins.left}pt; }
        body { font-family: ${schema.font}, sans-serif; font-size: ${schema.fontSize}pt; margin: 0; padding: 20px; color: #000; }
        table { page-break-inside: avoid; }
        .footer { position: fixed; bottom: 0; left: 0; right: 0; padding: 0 ${schema.margins.right}pt 0 ${schema.margins.left}pt; }
      </style>
    </head><body>
      ${renderHeader()}
      ${renderSections(schema.sections, schema.sections[0]?.gap ?? 0)}
      ${schema.footer.sections.length ? `<div class="footer">${renderSections(schema.footer.sections, 0)}</div>` : ""}
    </body></html>`;

    const iframe = document.createElement("iframe");
    iframe.style.position = "fixed";
    iframe.style.top = "-10000px";
    document.body.appendChild(iframe);
    const doc = iframe.contentDocument || iframe.contentWindow?.document;
    if (doc) {
      doc.open();
      doc.write(html);
      doc.close();
      iframe.onload = () => {
        iframe.contentWindow?.print();
        setTimeout(() => document.body.removeChild(iframe), 1000);
      };
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
              <Input value={schema.font} onChange={(e) => updateSchema({ ...schema, font: e.target.value })} className="w-48" />
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

      {/* Footer */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Footer (repeats on all pages)</h2>
        </div>
        {schema.footer.sections.map((section, si) => (
          <SectionEditor key={section.id} section={section} onChange={(s) => updateFooterSection(si, s)} onRemove={() => {}} />
        ))}
      </div>

      <Separator />

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
