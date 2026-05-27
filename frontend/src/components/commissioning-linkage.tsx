"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import api from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";

interface RequirementTemplate {
  id: string;
  name: string;
  code: string;
  level_code: string;
  requirement_category: string;
  evidence_document_type: string;
}

export interface WorkItemDraft {
  name: string;
  sequence_no: number;
}

export interface CommissioningLinkage {
  requirementTemplateId: string;
  isPartialScope: boolean;
  workItems: WorkItemDraft[];
}

interface Props {
  projectId: string;
  documentType: string; // WIR, CIR, MIR
  value: CommissioningLinkage | null;
  onChange: (linkage: CommissioningLinkage | null) => void;
}

export function CommissioningLinkagePanel({ projectId, documentType, value, onChange }: Props) {
  const [enabled, setEnabled] = useState(!!value);
  const [newItemName, setNewItemName] = useState("");

  // Fetch requirement templates filtered by evidence_document_type
  const { data: templates = [] } = useQuery<RequirementTemplate[]>({
    queryKey: ["requirement-templates", projectId, documentType],
    queryFn: async () => {
      const res = await api.get("/commissioning/requirement-templates", { params: { project_id: projectId } });
      return (res.data as RequirementTemplate[]).filter((t) => t.evidence_document_type === documentType);
    },
    enabled: !!projectId,
  });

  const selectedTemplate = value ? templates.find((t) => t.id === value.requirementTemplateId) : null;

  const handleToggle = (on: boolean) => {
    setEnabled(on);
    if (!on) onChange(null);
  };

  const handleTemplateSelect = (templateId: string) => {
    onChange({ requirementTemplateId: templateId, isPartialScope: false, workItems: [] });
  };

  const handlePartialToggle = (partial: boolean) => {
    if (!value) return;
    onChange({ ...value, isPartialScope: partial, workItems: partial ? value.workItems : [] });
  };

  const addWorkItem = () => {
    if (!value || !newItemName.trim()) return;
    const items = [...value.workItems, { name: newItemName.trim(), sequence_no: value.workItems.length + 1 }];
    onChange({ ...value, workItems: items });
    setNewItemName("");
  };

  const removeWorkItem = (index: number) => {
    if (!value) return;
    const items = value.workItems.filter((_, i) => i !== index);
    onChange({ ...value, workItems: items });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium">Commissioning Requirement Linkage</p>
          <p className="text-xs text-muted-foreground">Optionally link this document to a commissioning requirement for all listed assets</p>
        </div>
        <Switch checked={enabled} onCheckedChange={handleToggle} />
      </div>

      {enabled && (
        <div className="space-y-3 pl-1">
          {/* Requirement template selection */}
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Requirement</label>
            <Select value={value?.requirementTemplateId || ""} onValueChange={(v: any) => handleTemplateSelect(v)}>
              <SelectTrigger><SelectValue placeholder="Select requirement...">{selectedTemplate ? `[${selectedTemplate.level_code}] ${selectedTemplate.name}` : ""}</SelectValue></SelectTrigger>
              <SelectContent>
                {templates.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    <span className="flex items-center gap-2">
                      <span className="font-mono text-xs text-muted-foreground">[{t.level_code}]</span>
                      <span>{t.name}</span>
                      <Badge variant="outline" className="text-[10px] ml-2">{t.requirement_category}</Badge>
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {templates.length === 0 && (
            <p className="text-xs text-muted-foreground">No {documentType} requirement templates found for this project.</p>
          )}

          {/* Partial scope toggle */}
          {value?.requirementTemplateId && (
            <>
              <Separator />
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm">Partial scope?</p>
                  <p className="text-xs text-muted-foreground">
                    {value.isPartialScope
                      ? "This document covers only part of the requirement. Add work items below."
                      : "This document covers the full scope of the requirement."}
                  </p>
                </div>
                <Switch checked={value.isPartialScope} onCheckedChange={handlePartialToggle} />
              </div>
            </>
          )}

          {/* Work items (when partial) */}
          {value?.isPartialScope && (
            <div className="space-y-2 rounded-lg border p-3">
              <p className="text-xs font-medium text-muted-foreground uppercase">Work Breakdown Items</p>
              {value.workItems.length === 0 && (
                <p className="text-xs text-muted-foreground">No work items yet. Add items to describe the partial scope.</p>
              )}
              {value.workItems.map((item, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground w-5">{i + 1}.</span>
                  <span className="flex-1 text-sm">{item.name}</span>
                  <button type="button" onClick={() => removeWorkItem(i)} className="text-muted-foreground hover:text-destructive">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
              <div className="flex gap-2 pt-1">
                <Input
                  placeholder="e.g. MDB-01 to DB-1A"
                  value={newItemName}
                  onChange={(e) => setNewItemName(e.target.value)}
                  className="h-8 text-sm flex-1"
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addWorkItem(); } }}
                />
                <Button type="button" size="sm" variant="outline" className="h-8" disabled={!newItemName.trim()} onClick={addWorkItem}>
                  <Plus className="h-3 w-3 mr-1" />Add
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
