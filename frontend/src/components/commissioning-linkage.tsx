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
import { Checkbox } from "@/components/ui/checkbox";

interface RequirementTemplate {
  id: string;
  name: string;
  code: string;
  level_code: string;
  requirement_category: string;
  evidence_document_type: string;
  is_gate_requirement: boolean;
}

interface ExistingWorkItem {
  id: string;
  name: string;
  status: string; // not_started, submitted, approved
  sequence_no: number;
}

export interface CommissioningLinkage {
  requirementTemplateId: string;
  isPartialScope: boolean;
  checkedExistingIds: string[];
  deleteExistingIds: string[];
  newItems: { name: string; checked: boolean }[];
  gateWarningAcknowledged?: boolean;
  incompleteRequirements?: { requirement_id: string; status: string }[];
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

  const { data: templates = [] } = useQuery<RequirementTemplate[]>({
    queryKey: ["requirement-templates", projectId, documentType],
    queryFn: async () => {
      const res = await api.get("/commissioning/requirement-templates", { params: { project_id: projectId } });
      return (res.data as RequirementTemplate[]).filter((t) => t.evidence_document_type === documentType);
    },
    enabled: !!projectId,
  });

  // Fetch existing work items for first asset's requirement (representative)
  const { data: existingWorkItems = [] } = useQuery<ExistingWorkItem[]>({
    queryKey: ["work-items", selectedAssetIds[0], value?.requirementTemplateId],
    queryFn: async () => {
      const arRes = await api.get("/commissioning/asset-requirements", { params: { asset_id: selectedAssetIds[0] } });
      const ar = (arRes.data as any[]).find((r: any) => r.requirement_template_id === value?.requirementTemplateId);
      if (!ar) return [];
      return (await api.get("/commissioning/work-items", { params: { asset_requirement_id: ar.id } })).data;
    },
    enabled: !!value?.requirementTemplateId && !!value?.isPartialScope && selectedAssetIds.length > 0,
  });

  const selectedTemplate = value ? templates.find((t) => t.id === value.requirementTemplateId) : null;

  // Gate check: if selected template is a gate requirement, check for incomplete prerequisites
  const { data: gateCheck } = useQuery<{ complete: boolean; incomplete: { requirement_id: string; template_name: string; template_code: string; status: string; progress_percent: number }[] }>({
    queryKey: ["gate-check", selectedAssetIds[0], selectedTemplate?.level_code],
    queryFn: async () => (await api.get("/commissioning/gate-check", { params: { asset_id: selectedAssetIds[0], level_code: selectedTemplate!.level_code } })).data,
    enabled: !!selectedTemplate?.is_gate_requirement && selectedAssetIds.length > 0,
  });

  const isGateWarning = selectedTemplate?.is_gate_requirement && gateCheck && !gateCheck.complete;

  const handleToggle = (on: boolean) => {
    setEnabled(on);
    if (!on) onChange(null);
  };

  const handleTemplateSelect = (templateId: string) => {
    onChange({ requirementTemplateId: templateId, isPartialScope: false, checkedExistingIds: [], deleteExistingIds: [], newItems: [] });
  };

  const handlePartialToggle = (partial: boolean) => {
    if (!value) return;
    onChange({ ...value, isPartialScope: partial, checkedExistingIds: [], deleteExistingIds: [], newItems: [] });
  };

  // Toggle check on an existing pending item
  const toggleExistingCheck = (id: string) => {
    if (!value) return;
    const checked = value.checkedExistingIds.includes(id)
      ? value.checkedExistingIds.filter((x) => x !== id)
      : [...value.checkedExistingIds, id];
    onChange({ ...value, checkedExistingIds: checked });
  };

  // Mark existing item for deletion
  const markForDelete = (id: string) => {
    if (!value) return;
    onChange({
      ...value,
      deleteExistingIds: [...value.deleteExistingIds, id],
      checkedExistingIds: value.checkedExistingIds.filter((x) => x !== id),
    });
  };

  // Add new item (unchecked by default)
  const addNewItem = () => {
    if (!value || !newItemName.trim()) return;
    onChange({ ...value, newItems: [...value.newItems, { name: newItemName.trim(), checked: false }] });
    setNewItemName("");
  };

  // Toggle check on a new item
  const toggleNewCheck = (index: number) => {
    if (!value) return;
    const items = value.newItems.map((item, i) => i === index ? { ...item, checked: !item.checked } : item);
    onChange({ ...value, newItems: items });
  };

  // Remove a new item before save
  const removeNewItem = (index: number) => {
    if (!value) return;
    onChange({ ...value, newItems: value.newItems.filter((_, i) => i !== index) });
  };

  // Items to display (existing minus deleted)
  const visibleExisting = existingWorkItems.filter((wi) => !value?.deleteExistingIds.includes(wi.id));

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

          {/* Gate warning */}
          {isGateWarning && (
            <div className="rounded-md border border-amber-500/50 bg-amber-500/5 p-3 space-y-2">
              <p className="text-sm font-medium text-amber-500">⚠ Incomplete Prerequisites</p>
              <p className="text-xs text-muted-foreground">The following {selectedTemplate?.level_code} requirements are not yet achieved:</p>
              <ul className="space-y-1">
                {gateCheck!.incomplete.map((r, i) => (
                  <li key={i} className="text-xs flex items-center gap-2">
                    <span className="font-mono text-muted-foreground">{r.template_code}</span>
                    <span>{r.template_name}</span>
                    <Badge variant="outline" className="text-[10px] ml-auto">{r.status} ({r.progress_percent}%)</Badge>
                  </li>
                ))}
              </ul>
              <p className="text-xs text-amber-500/80">You may proceed, but the tag will not be achieved until all requirements are completed.</p>
              {!value?.gateWarningAcknowledged ? (
                <Button size="sm" variant="outline" className="border-amber-500/50 text-amber-500 hover:bg-amber-500/10" onClick={() => {
                  if (!value) return;
                  onChange({ ...value, gateWarningAcknowledged: true, incompleteRequirements: gateCheck!.incomplete.map((r) => ({ requirement_id: r.requirement_id, status: r.status })) });
                }}>
                  I acknowledge — proceed anyway
                </Button>
              ) : (
                <p className="text-xs text-emerald-500">✓ Acknowledged</p>
              )}
            </div>
          )}

          {value?.requirementTemplateId && (
            <>
              <Separator />
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm">Partial scope?</p>
                  <p className="text-xs text-muted-foreground">
                    {value.isPartialScope
                      ? "Create work items and check the ones covered by this document."
                      : "This document covers the full scope of the requirement."}
                  </p>
                </div>
                <Switch checked={value.isPartialScope} onCheckedChange={handlePartialToggle} />
              </div>
            </>
          )}

          {value?.isPartialScope && (
            <div className="space-y-3 rounded-lg border p-3">
              <p className="text-xs font-medium text-muted-foreground uppercase">Work Breakdown Items</p>
              <p className="text-xs text-muted-foreground">Check items covered by this document. Unchecked items remain for future documents.</p>

              {/* Existing items */}
              {visibleExisting.map((item) => {
                const isDone = item.status === "approved";
                const isChecked = isDone || value.checkedExistingIds.includes(item.id);
                return (
                  <div key={item.id} className="flex items-center gap-2">
                    <Checkbox
                      checked={isChecked}
                      disabled={isDone}
                      onCheckedChange={() => !isDone && toggleExistingCheck(item.id)}
                    />
                    <span className={`flex-1 text-sm ${isDone ? "line-through text-muted-foreground" : ""}`}>{item.name}</span>
                    {isDone && <Badge variant="outline" className="text-[10px]">Done</Badge>}
                    {!isDone && (
                      <button type="button" onClick={() => markForDelete(item.id)} className="text-muted-foreground hover:text-destructive">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                );
              })}

              {/* New items */}
              {value.newItems.map((item, i) => (
                <div key={`new-${i}`} className="flex items-center gap-2">
                  <Checkbox checked={item.checked} onCheckedChange={() => toggleNewCheck(i)} />
                  <span className="flex-1 text-sm">{item.name}</span>
                  <Badge variant="outline" className="text-[10px]">New</Badge>
                  <button type="button" onClick={() => removeNewItem(i)} className="text-muted-foreground hover:text-destructive">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}

              {/* Add new */}
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
