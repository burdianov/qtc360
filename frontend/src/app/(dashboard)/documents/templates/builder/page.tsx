"use client";

import { useState, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  Plus,
  Trash2,
  GripVertical,
  ChevronDown,
  ChevronRight,
  Settings2,
  Type,
  CheckSquare,
  Database,
} from "lucide-react";
import api from "@/lib/api";
import { useSelectedProject } from "@/hooks/use-project";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";

// --- Types ---

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
  header: { imageUrl: string; height: number };
  footer: { sections: Section[] };
  sections: Section[];
  sectionGap: number;
}

// --- Helpers ---

const uid = () => crypto.randomUUID().slice(0, 8);

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
  header: { imageUrl: "", height: 60 },
  footer: { sections: [defaultSection("Footer")] },
  sections: [defaultSection("Section 1")],
  sectionGap: 10,
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

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (templateId) {
        return api.patch(`/templates/${templateId}`, { name, template_schema: schema });
      }
      return api.post("/templates", { project_id: project!.id, doc_type: docType, name, template_schema: schema });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["templates"] });
      router.push("/documents/templates");
    },
  });

  const updateSection = (idx: number, section: Section) => {
    const sections = [...schema.sections];
    sections[idx] = section;
    setSchema({ ...schema, sections });
  };

  const removeSection = (idx: number) => {
    setSchema({ ...schema, sections: schema.sections.filter((_, i) => i !== idx) });
  };

  const addSection = () => {
    setSchema({ ...schema, sections: [...schema.sections, defaultSection(`Section ${schema.sections.length + 1}`)] });
  };

  const updateFooterSection = (idx: number, section: Section) => {
    const sections = [...schema.footer.sections];
    sections[idx] = section;
    setSchema({ ...schema, footer: { ...schema.footer, sections } });
  };

  return (
    <div className="space-y-6 max-w-5xl">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="sm" onClick={() => router.push("/documents/templates")}>
          <ArrowLeft className="h-4 w-4 mr-1" />Back
        </Button>
        <div className="flex-1">
          <h1 className="text-2xl font-semibold tracking-tight">Template Builder</h1>
          <p className="text-sm text-muted-foreground">Design document cover sheet layout</p>
        </div>
        <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
          {saveMutation.isPending ? "Saving..." : "Save Template"}
        </Button>
      </div>

      {/* Template Settings */}
      <Card>
        <CardHeader><CardTitle className="text-base flex items-center gap-2"><Settings2 className="h-4 w-4" />Template Settings</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <label className="text-xs text-muted-foreground">Name</label>
              <Input value={name} onChange={(e) => setName(e.target.value)} className="mt-1" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Document Type</label>
              <Select value={docType} onValueChange={(v) => v && setDocType(v as string)}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="WIR">WIR</SelectItem>
                  <SelectItem value="MIR">MIR</SelectItem>
                  <SelectItem value="CIR">CIR</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Font</label>
              <Input value={schema.font} onChange={(e) => setSchema({ ...schema, font: e.target.value })} className="mt-1" />
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-5">
            <div>
              <label className="text-xs text-muted-foreground">Font Size</label>
              <Input type="number" value={schema.fontSize} onChange={(e) => setSchema({ ...schema, fontSize: Number(e.target.value) })} className="mt-1" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Margin Top</label>
              <Input type="number" value={schema.margins.top} onChange={(e) => setSchema({ ...schema, margins: { ...schema.margins, top: Number(e.target.value) } })} className="mt-1" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Margin Right</label>
              <Input type="number" value={schema.margins.right} onChange={(e) => setSchema({ ...schema, margins: { ...schema.margins, right: Number(e.target.value) } })} className="mt-1" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Margin Bottom</label>
              <Input type="number" value={schema.margins.bottom} onChange={(e) => setSchema({ ...schema, margins: { ...schema.margins, bottom: Number(e.target.value) } })} className="mt-1" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Margin Left</label>
              <Input type="number" value={schema.margins.left} onChange={(e) => setSchema({ ...schema, margins: { ...schema.margins, left: Number(e.target.value) } })} className="mt-1" />
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="text-xs text-muted-foreground">Header Image URL</label>
              <Input value={schema.header.imageUrl} onChange={(e) => setSchema({ ...schema, header: { ...schema.header, imageUrl: e.target.value } })} className="mt-1" placeholder="/uploads/header.jpg" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Header Height (pt)</label>
              <Input type="number" value={schema.header.height} onChange={(e) => setSchema({ ...schema, header: { ...schema.header, height: Number(e.target.value) } })} className="mt-1" />
            </div>
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Section Gap (pt)</label>
            <Input type="number" value={schema.sectionGap} onChange={(e) => setSchema({ ...schema, sectionGap: Number(e.target.value) })} className="mt-1 w-24" />
          </div>
        </CardContent>
      </Card>

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
    </div>
  );
}
