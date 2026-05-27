"use client";

import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import api from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";

interface RequirementTemplate {
  id: string;
  name: string;
  code: string;
  level_code: string;
  requirement_category: string;
  evidence_document_type: string;
}

interface ExistingWorkItem {
  id: string;
  name: string;
  status: string; // not_started, submitted, approved
  sequence_no: number;
  linked_document_id: string | null;
}

export interface WorkItemSelection {
  existingId?: string; // if selecting an existing work item
  name: string;
  isNew: boolean;
}

export interface CommissioningLinkage {
  requirementTemplateId: string;
  isPartialScope: boolean;
  selectedWorkItems: WorkItemSelection[]; // items covered by THIS document
  newWorkItems: string[]; // new items to create (names)
}

interface Props {
  projectId: string;
  selectedAssetIds: string[];
  documentType: string;
  value: CommissioningLinkage | null;
  onChange: (linkage: CommissioningLinkage | null) => void;
}

export function CommissioningLinkagePanel({ projectId, selectedAssetIds, documentType, value, onChange }: Props) {
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

  // Fetch existing work items for the first selected asset's requirement
  // (work items are per asset_requirement, we use first asset as reference)
  const { data: existingWorkItems = [] } = useQuery<ExistingWorkItem[]>({
    queryKey: ["work-items", selectedAssetIds[0], value?.requirementTemplateId],
    queryFn: async () => {
      // Find asset_requirement for first asset
      const arRes = await api.get("/commissioning/asset-requirements", { params: { asset_id: selectedAssetIds[0] } });
      const ar = (arRes.data as any[]).find((r: any) => r.requirement_template_id === value?.requirementTemplateId);
      if (!ar) return [];
      const wiRes = await api.get("/commissioning/work-items", { params: { asset_requirement_id: ar.id } });
      return wiRes.data;
    },
    enabled: !!value?.requirementTemplateId && !!value?.isPartialScope && selectedAssetIds.length > 0,
  });

  const selectedTemplate = value ? templates.find((t) => t.id === value.requirementTemplateId) : null;

  const handleToggle = (on: boolean) => {
    setEnabled(on);
    if (!on) onChange(null);
  };

  const handleTemplateSelect = (templateId: string) => {
    onChange({ requirementTemplateId: templateId, isPartialScope: false, selectedWorkItems: [], newWorkItems: [] });
  };

  const handlePartialToggle = (partial: boolean) => {
    if (!value) return;
    onChange({ ...value, isPartialScope: partial, selectedWorkItems: [], newWorkItems: [] });
  };

  const toggleExistingItem = (item: ExistingWorkItem) => {
    if (!value) return;
    const exists = value.selectedWorkItems.find((s) => s.existingId === item.id);
    if (exists) {
      onChange({ ...value, selectedWorkItems: value.selectedWorkItems.filter((s) => s.existingId !== item.id) });
    } else {
      onChange({ ...value, selectedWorkItems: [...value.selectedWorkItems, { existingId: item.id, name: item.name, isNew: false }] });
    }
  };

  const addNewItem = () => {
    if (!value || !newItemName.trim()) return;
    onChange({ ...value, newWorkItems: [...value.newWorkItems, newItemName.trim()] });
    setNewItemName("");
  };

  const removeNewItem = (index: number) => {
    if (!value) return;
    onChange({ ...value, newWorkItems: value.newWorkItems.filter((_, i) => i !== index) });
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
            <p className="text-xs text-muted-foreground">No {documentType} requirement templates found.</p>
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
                      ? "Select which work items this document covers."
                      : "This document covers the full scope of the requirement."}
                  </p>
                </div>
                <Switch checked={value.isPartialScope} onCheckedChange={handlePartialToggle} />
              </div>
            </>
          )}

          {/* Work items (when partial) */}
          {value?.isPartialScope && (
            <div className="space-y-3 rounded-lg border p-3">
              <p className="text-xs font-medium text-muted-foreground uppercase">Work Breakdown Items</p>

              {/* Existing work items (from previous WIRs) */}
              {existingWorkItems.length > 0 && (
                <div className="space-y-1.5">
                  {existingWorkItems.map((item) => {
                    const isApproved = item.status === "approved";
                    const isChecked = isApproved || !!value.selectedWorkItems.find((s) => s.existingId === item.id);
                    return (
                      <label key={item.id} className="flex items-center gap-2 text-sm">
                        <Checkbox
                          checked={isChecked}
                          disabled={isApproved}
                          onCheckedChange={() => !isApproved && toggleExistingItem(item)}
                        />
                        <span className={isApproved ? "line-through text-muted-foreground" : ""}>{item.name}</span>
                        {isApproved && <Badge variant="outline" className="text-[10px] ml-auto">Done</Badge>}
                      </label>
                    );
                  })}
                </div>
              )}

              {/* New items to add */}
              {value.newWorkItems.length > 0 && (
                <div className="space-y-1.5 pt-1">
                  {existingWorkItems.length > 0 && <Separator />}
                  <p className="text-xs text-muted-foreground">New items (will be created):</p>
                  {value.newWorkItems.map((name, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <Checkbox checked disabled />
                      <span className="flex-1 text-sm">{name}</span>
                      <button type="button" onClick={() => removeNewItem(i)} className="text-muted-foreground hover:text-destructive">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* Add new item */}
              <div className="flex gap-2 pt-1">
                <Input
                  placeholder="e.g. MDB-01 to DB-1A"
                  value={newItemName}
                  onChange={(e) => setNewItemName(e.target.value)}
                  className="h-8 text-sm flex-1"
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addNewItem(); } }}
                />
                <Button type="button" size="sm" variant="outline" className="h-8" disabled={!newItemName.trim()} onClick={addNewItem}>
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
