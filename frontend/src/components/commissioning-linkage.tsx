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

interface AssetRequirement {
  id: string;
  asset_id: string;
  requirement_template_id: string;
  status: string;
}

export interface WorkItemDraft {
  name: string;
  sequence_no: number;
}

export interface CommissioningLinkage {
  assetRequirementId: string;
  isPartialScope: boolean;
  workItems: WorkItemDraft[];
}

interface Props {
  projectId: string;
  selectedAssets: { id: string; tag_number: string; name: string }[];
  documentType: string; // WIR, CIR, MIR
  value: CommissioningLinkage | null;
  onChange: (linkage: CommissioningLinkage | null) => void;
}

export function CommissioningLinkagePanel({ projectId, selectedAssets, documentType, value, onChange }: Props) {
  const [enabled, setEnabled] = useState(!!value);
  const [selectedAssetId, setSelectedAssetId] = useState(value ? "" : "");
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

  // Fetch asset requirements for selected asset
  const { data: assetRequirements = [] } = useQuery<AssetRequirement[]>({
    queryKey: ["asset-requirements", selectedAssetId],
    queryFn: async () => (await api.get("/commissioning/asset-requirements", { params: { asset_id: selectedAssetId } })).data,
    enabled: !!selectedAssetId,
  });

  // Filter to only show requirements matching available templates
  const templateMap = Object.fromEntries(templates.map((t) => [t.id, t]));
  const availableRequirements = assetRequirements.filter((ar) => templateMap[ar.requirement_template_id]);

  const handleToggle = (on: boolean) => {
    setEnabled(on);
    if (!on) onChange(null);
  };

  const handleAssetSelect = (assetId: string) => {
    setSelectedAssetId(assetId);
    onChange(null); // Reset when asset changes
  };

  const handleRequirementSelect = (assetReqId: string) => {
    onChange({ assetRequirementId: assetReqId, isPartialScope: false, workItems: [] });
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

  const selectedTemplate = value ? templateMap[assetRequirements.find((ar) => ar.id === value.assetRequirementId)?.requirement_template_id || ""] : null;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium">Commissioning Requirement Linkage</p>
          <p className="text-xs text-muted-foreground">Optionally link this document to a commissioning requirement</p>
        </div>
        <Switch checked={enabled} onCheckedChange={handleToggle} />
      </div>

      {enabled && (
        <div className="space-y-3 pl-1">
          {/* Asset selection (from already selected assets) */}
          {selectedAssets.length > 0 ? (
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Asset</label>
              <Select value={selectedAssetId} onValueChange={(v: any) => handleAssetSelect(v)}>
                <SelectTrigger><SelectValue placeholder="Select asset for requirement...">{selectedAssetId ? (() => { const a = selectedAssets.find((x) => x.id === selectedAssetId); return a ? `${a.tag_number} — ${a.name}` : ""; })() : ""}</SelectValue></SelectTrigger>
                <SelectContent>
                  {selectedAssets.map((a) => (
                    <SelectItem key={a.id} value={a.id}>{a.tag_number} — {a.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : (
            <p className="text-xs text-amber-500">Add assets above first to link a requirement.</p>
          )}

          {/* Requirement selection */}
          {selectedAssetId && availableRequirements.length > 0 && (
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Requirement</label>
              <Select value={value?.assetRequirementId || ""} onValueChange={(v: any) => handleRequirementSelect(v)}>
                <SelectTrigger><SelectValue placeholder="Select requirement...">{value?.assetRequirementId ? (() => { const ar = assetRequirements.find((x) => x.id === value.assetRequirementId); const tmpl = ar ? templateMap[ar.requirement_template_id] : null; return tmpl ? `[${tmpl.level_code}] ${tmpl.name}` : ""; })() : ""}</SelectValue></SelectTrigger>
                <SelectContent>
                  {availableRequirements.map((ar) => {
                    const tmpl = templateMap[ar.requirement_template_id];
                    return (
                      <SelectItem key={ar.id} value={ar.id}>
                        <span className="flex items-center gap-2">
                          <span className="font-mono text-xs text-muted-foreground">[{tmpl?.level_code}]</span>
                          <span>{tmpl?.name}</span>
                          {ar.status !== "not_started" && <Badge variant="outline" className="text-[10px] ml-auto">{ar.status}</Badge>}
                        </span>
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
            </div>
          )}

          {selectedAssetId && availableRequirements.length === 0 && (
            <p className="text-xs text-muted-foreground">No {documentType} requirements found for this asset.</p>
          )}

          {/* Partial scope toggle */}
          {value?.assetRequirementId && (
            <>
              <Separator />
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm">Partial scope?</p>
                  <p className="text-xs text-muted-foreground">
                    {value.isPartialScope
                      ? "This WIR covers only part of the requirement. Add work items below."
                      : "This WIR covers the full scope of the requirement."}
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
