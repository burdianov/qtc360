"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ChevronDown, ChevronRight, X, Plus, Trash2 } from "lucide-react";
import api from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

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
  status: string;
  sequence_no: number;
  asset_requirement_id: string;
}

export interface AssetLinkageState {
  assetRequirementId: string;
  existingItems: ExistingWorkItem[];
  checkedExistingIds: string[];
  deleteExistingIds: string[];
  newItems: { name: string; checked: boolean }[];
}

export interface CommissioningLinkageBlock {
  id: string; // client-side key
  requirementTemplateId: string;
  assetIds: string[]; // assets selected for THIS block
  isPartialScope: boolean;
  assetStates: Record<string, AssetLinkageState>; // keyed by assetId
  gateWarningAcknowledged?: boolean;
  gateOverrideNotes?: string;
  gateLevelCode?: string;
  incompleteRequirements?: { requirement_id: string; status: string }[];
}

export type CommissioningLinkage = CommissioningLinkageBlock[];

// ─── Props ──────────────────────────────────────────────────────────────────────

interface Props {
  /** All project assets */
  allAssetIds: string[];
  allAssetLabels?: Record<string, string>;
  /** Asset names keyed by id — shown alongside tag_number for clarity */
  allAssetNames?: Record<string, string>;
  /** All asset requirements for the project — used to filter assets per block */
  allAssetRequirements?: { id: string; asset_id: string; requirement_template_id: string; status: string }[];
  documentType: string;
  /** Requirement templates (passed from parent to avoid duplicate fetch) */
  templates: RequirementTemplate[];
  /** Requirements selected in the top section */
  selectedRequirements: { id: string; requirementTemplateId: string }[];
  value: CommissioningLinkageBlock[] | null;
  onChange: (linkage: CommissioningLinkageBlock[] | null) => void;
  /** Called when assets are unlinked from a block — for DB cleanup */
  onUnlinkAssets?: (requirementTemplateId: string, assetIds: string[]) => void;
}

export function CommissioningLinkagePanel({
  allAssetIds,
  allAssetLabels,
  allAssetNames,
  allAssetRequirements,
  documentType: _documentType,
  templates,
  selectedRequirements,
  value,
  onChange,
  onUnlinkAssets,
}: Props) {
  const blocks = value ?? [];

  const updateBlock = (idx: number, patch: Partial<CommissioningLinkageBlock>) => {
    onChange(blocks.map((b, i) => (i === idx ? { ...b, ...patch } : b)));
  };

  if (selectedRequirements.length === 0) {
    return (
      <div className="space-y-3">
        <div>
          <p className="text-sm font-medium">Commissioning Requirement Linkage</p>
          <p className="text-xs text-muted-foreground">
            Select requirements above to link them to assets
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div>
        <p className="text-sm font-medium">Commissioning Requirement Linkage</p>
        <p className="text-xs text-muted-foreground">
          Link requirements to assets and manage partial scope
        </p>
      </div>

      <div className="space-y-3">
        {blocks.map((block, idx) => {
          const template = templates.find((t) => t.id === block.requirementTemplateId);
          if (!template) return null;
          return (
            <LinkageBlock
              key={block.id}
              block={block}
              template={template}
              index={idx}
              allAssetIds={allAssetIds}
              allAssetLabels={allAssetLabels}
              allAssetNames={allAssetNames}
              allAssetRequirements={allAssetRequirements}
              onChange={(patch) => updateBlock(idx, patch)}
              onUnlinkAssets={onUnlinkAssets}
            />
          );
        })}
      </div>
    </div>
  );
}

// ─── Single block ─────────────────────────────────────────────────────────────

interface BlockProps {
  block: CommissioningLinkageBlock;
  template: RequirementTemplate;
  index: number;
  allAssetIds: string[];
  allAssetLabels?: Record<string, string>;
  allAssetNames?: Record<string, string>;
  allAssetRequirements?: { id: string; asset_id: string; requirement_template_id: string; status: string }[];
  onChange: (patch: Partial<CommissioningLinkageBlock>) => void;
  onUnlinkAssets?: (requirementTemplateId: string, assetIds: string[]) => void;
}

function LinkageBlock({ block, template, index: _index, allAssetIds, allAssetLabels, allAssetNames, allAssetRequirements, onChange, onUnlinkAssets }: BlockProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [gateDialogOpen, setGateDialogOpen] = useState(false);
  const [gateNotes, setGateNotes] = useState("");

  const firstAssetId = block.assetIds[0] ?? "";

  const { data: gateCheck } = useQuery<{
    complete: boolean;
    incomplete: { requirement_id: string; template_name: string; template_code: string; status: string; progress_percent: number }[];
  }>({
    queryKey: ["gate-check", firstAssetId, template.level_code],
    queryFn: async () => (await api.get("/commissioning/gate-check", {
      params: { asset_id: firstAssetId, level_code: template.level_code },
    })).data,
    enabled: !!template.is_gate_requirement && block.assetIds.length > 0,
  });

  const isGateWarning = template.is_gate_requirement && gateCheck && !gateCheck.complete;

  const templateLabel = `[${template.level_code}] ${template.name}`;
  const assetSummary = block.assetIds.length > 0
    ? block.assetIds.map((id) => allAssetLabels?.[id] ?? id.slice(0, 6)).join(", ")
    : "no assets";

  // Available assets for this requirement template
  const availableAssetIds = allAssetRequirements
    ? allAssetRequirements
        .filter((ar) => ar.requirement_template_id === block.requirementTemplateId && ar.status !== "achieved")
        .map((ar) => ar.asset_id)
    : allAssetIds;

  const toggleAsset = (assetId: string) => {
    const removing = block.assetIds.includes(assetId);
    const ids = removing
      ? block.assetIds.filter((x) => x !== assetId)
      : [...block.assetIds, assetId];
    const assetStates = { ...block.assetStates };
    if (removing) {
      delete assetStates[assetId];
      // Clean up DB if asset is being unlinked
      onUnlinkAssets?.(block.requirementTemplateId, [assetId]);
    }
    onChange({ assetIds: ids, assetStates });
  };

  const updateAssetState = (assetId: string, patch: Partial<AssetLinkageState>) => {
    onChange({ assetStates: { ...block.assetStates, [assetId]: { ...block.assetStates[assetId], ...patch } } });
  };

  return (
    <div className="rounded-lg border">
      <div className="flex items-center gap-2 px-3 py-2.5 cursor-pointer select-none" onClick={() => setCollapsed(!collapsed)}>
        {collapsed ? <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" /> : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />}
        <div className="flex-1 min-w-0">
          <span className="text-sm font-medium truncate block">{templateLabel}</span>
          {collapsed && <span className="text-xs text-muted-foreground">{assetSummary}</span>}
        </div>
        <Badge variant="outline" className="text-[10px] shrink-0">{template.level_code}</Badge>
        <Badge variant="outline" className="text-[10px] shrink-0">{template.requirement_category}</Badge>
      </div>

      {!collapsed && (
        <div className="px-3 pb-3 space-y-3 border-t pt-3">
          {/* Asset picker — only assets that have this requirement assigned */}
          <AssetPicker
            allAssetIds={availableAssetIds}
            allAssetLabels={allAssetLabels}
            allAssetNames={allAssetNames}
            selectedIds={block.assetIds}
            onToggle={toggleAsset}
          />

          {/* Gate warning */}
          {isGateWarning && (
            <div className="rounded-md border border-amber-500/50 bg-amber-500/5 p-3 space-y-2">
              <p className="text-sm font-medium text-amber-500">⚠ Incomplete Prerequisites</p>
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
              {!block.gateWarningAcknowledged ? (
                <Button size="sm" variant="outline" className="border-amber-500/50 text-amber-500 hover:bg-amber-500/10" onClick={() => setGateDialogOpen(true)}>
                  I acknowledge - proceed anyway
                </Button>
              ) : (
                <p className="text-xs text-emerald-500">✓ Acknowledged{block.gateOverrideNotes ? ` - "${block.gateOverrideNotes}"` : ""}</p>
              )}
              <Dialog open={gateDialogOpen} onOpenChange={setGateDialogOpen}>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                      <AlertTriangle className="h-5 w-5 text-amber-500" />
                      Confirm Gate Override
                    </DialogTitle>
                    <DialogDescription>
                      Proceeding with incomplete {template.level_code} prerequisites. This will be recorded.
                    </DialogDescription>
                  </DialogHeader>
                  <div className="space-y-3">
                    <div className="rounded-md border p-3 space-y-1 max-h-40 overflow-y-auto">
                      {gateCheck!.incomplete.map((r, i) => (
                        <div key={i} className="text-xs flex items-center gap-2">
                          <span className="font-mono text-muted-foreground">{r.template_code}</span>
                          <span className="flex-1">{r.template_name}</span>
                          <Badge variant="outline" className="text-[10px]">{r.status}</Badge>
                        </div>
                      ))}
                    </div>
                    <div>
                      <label className="text-sm font-medium">Reason for proceeding</label>
                      <Textarea placeholder="Explain why you are proceeding..." value={gateNotes} onChange={(e) => setGateNotes(e.target.value)} rows={3} className="mt-1" />
                    </div>
                  </div>
                  <DialogFooter>
                    <Button variant="outline" onClick={() => setGateDialogOpen(false)}>Cancel</Button>
                    <Button variant="destructive" onClick={() => {
                      onChange({ gateWarningAcknowledged: true, gateOverrideNotes: gateNotes || undefined, gateLevelCode: template.level_code, incompleteRequirements: gateCheck!.incomplete.map((r) => ({ requirement_id: r.requirement_id, status: r.status })) });
                      setGateDialogOpen(false);
                    }}>Confirm & Proceed</Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </div>
          )}

          {/* Partial scope — only when assets are selected */}
          {block.assetIds.length > 0 && (
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm">Partial scope?</p>
                <p className="text-xs text-muted-foreground">
                  {block.isPartialScope ? "Manage work items per asset below." : "This document covers the full scope for selected assets."}
                </p>
              </div>
              <Switch checked={block.isPartialScope} onCheckedChange={(v) => onChange({ isPartialScope: v, assetStates: {} })} />
            </div>
          )}

          {/* Per-asset work items */}
          {block.isPartialScope && block.assetIds.length > 0 && (
            <div className="space-y-2">
              {block.assetIds.map((assetId) => (
                <AssetWorkItemSection
                  key={assetId}
                  assetId={assetId}
                  assetLabel={allAssetLabels?.[assetId] ?? assetId.slice(0, 8)}
                  assetName={allAssetNames?.[assetId]}
                  requirementTemplateId={block.requirementTemplateId}
                  state={block.assetStates[assetId]}
                  onStateChange={(patch) => updateAssetState(assetId, patch)}
                />
              ))}
            </div>
          )}

          {availableAssetIds.length === 0 && (
            <p className="text-xs text-muted-foreground">No assets are linked to this requirement in the system.</p>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Asset picker with search ─────────────────────────────────────────────────

function AssetPicker({ allAssetIds, allAssetLabels, allAssetNames, selectedIds, onToggle }: {
  allAssetIds: string[];
  allAssetLabels?: Record<string, string>;
  allAssetNames?: Record<string, string>;
  selectedIds: string[];
  onToggle: (id: string) => void;
}) {
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState(false);
  const q = search.toLowerCase();
  const filtered = q
    ? allAssetIds.filter((id) => {
        const label = allAssetLabels?.[id] ?? id;
        const name = allAssetNames?.[id] ?? "";
        return label.toLowerCase().includes(q) || name.toLowerCase().includes(q);
      })
    : allAssetIds;

  return (
    <div className="space-y-1.5">
      <button type="button" onClick={() => setExpanded(!expanded)} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
        {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        Assets{selectedIds.length > 0 && ` (${selectedIds.length})`}
      </button>
      {selectedIds.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {selectedIds.map((id) => (
            <span key={id} className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs border bg-primary/10 border-primary/50 text-primary">
              <span className="font-mono">{allAssetLabels?.[id] ?? id.slice(0, 8)}</span>
              {allAssetNames?.[id] && <span className="text-muted-foreground">- {allAssetNames[id]}</span>}
              <button type="button" onClick={() => onToggle(id)} className="ml-0.5 rounded-full p-0.5 hover:bg-destructive/20 hover:text-destructive transition-colors" aria-label={`Remove ${allAssetLabels?.[id] ?? id}`}>
                <X className="h-2.5 w-2.5" />
              </button>
            </span>
          ))}
        </div>
      )}
      {expanded && (
        <>
          {allAssetIds.length > 6 && (
            <Input placeholder="Search assets..." value={search} onChange={(e) => setSearch(e.target.value)} className="h-7 text-xs" />
          )}
          <div className="rounded-md border max-h-32 overflow-y-auto">
            {filtered.length === 0 ? (
              <p className="px-3 py-2 text-xs text-muted-foreground">No assets found.</p>
            ) : (
              filtered.slice(0, 50).map((assetId) => {
                const selected = selectedIds.includes(assetId);
                return (
                  <label key={assetId} className="flex items-center gap-2 px-3 py-1.5 hover:bg-accent/50 cursor-pointer border-b last:border-b-0 text-xs">
                    <input type="checkbox" checked={selected} onChange={() => onToggle(assetId)} className="h-3.5 w-3.5 rounded border-input" />
                    <span className={`font-mono ${selected ? "font-medium" : ""}`} style={{ minWidth: "10rem" }}>{allAssetLabels?.[assetId] ?? assetId.slice(0, 8)}</span>
                    {allAssetNames?.[assetId] && <span className="text-muted-foreground">{allAssetNames[assetId]}</span>}
                  </label>
                );
              })
            )}
          </div>
        </>
      )}
    </div>
  );
}

// ─── Per-asset work items ─────────────────────────────────────────────────────

interface AssetWorkItemSectionProps {
  assetId: string;
  assetLabel: string;
  assetName?: string;
  requirementTemplateId: string;
  state?: AssetLinkageState;
  onStateChange: (patch: Partial<AssetLinkageState>) => void;
}

function AssetWorkItemSection({ assetId, assetLabel, assetName, requirementTemplateId, state, onStateChange }: AssetWorkItemSectionProps) {
  const [newItemName, setNewItemName] = useState("");
  const [collapsed, setCollapsed] = useState(true);
  const [initialized, setInitialized] = useState(false);

  const { data: assetRequirements = [] } = useQuery<{ id: string; asset_id: string; requirement_template_id: string; status: string }[]>({
    queryKey: ["asset-requirements-for-asset", assetId],
    queryFn: async () => (await api.get("/commissioning/asset-requirements", { params: { asset_id: assetId } })).data,
    enabled: !!assetId,
  });

  const assetReq = assetRequirements.find((ar) => ar.requirement_template_id === requirementTemplateId);

  const { data: workItems = [] } = useQuery<ExistingWorkItem[]>({
    queryKey: ["work-items", assetReq?.id],
    queryFn: async () => (await api.get("/commissioning/work-items", { params: { asset_requirement_id: assetReq!.id } })).data,
    enabled: !!assetReq?.id,
  });

  // Initialize state from API (once)
  if (!initialized && assetReq && workItems.length > 0 && !state?.assetRequirementId) {
    setInitialized(true);
    const seen = new Set<string>();
    const unique = workItems.filter((w) => { if (seen.has(w.id)) return false; seen.add(w.id); return true; });
    onStateChange({ assetRequirementId: assetReq.id, existingItems: unique, checkedExistingIds: state?.checkedExistingIds ?? [], deleteExistingIds: state?.deleteExistingIds ?? [], newItems: state?.newItems ?? [] });
  }

  if (!assetReq) {
    return (
      <div className="rounded-md border px-3 py-2 flex items-center justify-between">
        <span className="text-sm font-medium">{assetLabel}{assetName && <span className="text-muted-foreground font-normal ml-2">- {assetName}</span>}</span>
        <span className="text-xs text-muted-foreground">No requirement assigned to this asset</span>
      </div>
    );
  }

  const existingItems = state?.existingItems ?? workItems;
  const visibleItems = existingItems.filter((wi) => !(state?.deleteExistingIds ?? []).includes(wi.id));
  const checkedIds = state?.checkedExistingIds ?? [];
  const newItems = state?.newItems ?? [];
  const approvedCount = existingItems.filter((wi) => wi.status === "approved").length;

  const addNew = () => {
    if (!newItemName.trim()) return;
    const updatedNewItems = [...newItems, { name: newItemName.trim(), checked: false }];
    onStateChange({ newItems: updatedNewItems });
    setNewItemName("");
  };

  return (
    <div className="rounded-md border">
      <div className="flex items-center gap-2 px-3 py-2 cursor-pointer select-none" onClick={() => setCollapsed(!collapsed)}>
        {collapsed ? <ChevronRight className="h-3 w-3 text-muted-foreground shrink-0" /> : <ChevronDown className="h-3 w-3 text-muted-foreground shrink-0" />}
        <span className="text-sm font-medium flex-1">{assetLabel}{assetName && <span className="text-muted-foreground font-normal ml-2">- {assetName}</span>}</span>
        {existingItems.length > 0 && <span className="text-xs text-muted-foreground">{approvedCount}/{existingItems.length} approved</span>}
        {assetReq.status === "achieved" && <Badge className="text-[10px] bg-emerald-500/20 text-emerald-400 border-emerald-500/30">Achieved</Badge>}
      </div>

      {!collapsed && (
        <div className="px-3 pb-3 space-y-2 border-t pt-2">
          {visibleItems.map((item) => {
            const isDone = item.status === "approved";
            const isChecked = isDone || checkedIds.includes(item.id);
            return (
              <div key={item.id} className="flex items-center gap-2">
                <Checkbox checked={isChecked} disabled={isDone} onCheckedChange={() => !isDone && onStateChange({ checkedExistingIds: isChecked ? checkedIds.filter((x) => x !== item.id) : [...checkedIds, item.id] })} />
                <span className={`flex-1 text-sm ${isDone ? "line-through text-muted-foreground" : ""}`}>{item.name}</span>
                {isDone ? <Badge variant="outline" className="text-[10px]">Done</Badge> : (
                  <button type="button" onClick={() => onStateChange({ deleteExistingIds: [...(state?.deleteExistingIds ?? []), item.id], checkedExistingIds: checkedIds.filter((x) => x !== item.id) })} className="text-muted-foreground hover:text-destructive">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            );
          })}

          {newItems.map((item, i) => (
            <div key={`new-${i}`} className="flex items-center gap-2">
              <Checkbox checked={item.checked} onCheckedChange={() => onStateChange({ newItems: newItems.map((ni, idx) => idx === i ? { ...ni, checked: !ni.checked } : ni) })} />
              <span className="flex-1 text-sm">{item.name}</span>
              <Badge variant="outline" className="text-[10px]">New</Badge>
              <button type="button" onClick={() => onStateChange({ newItems: newItems.filter((_, idx) => idx !== i) })} className="text-muted-foreground hover:text-destructive">
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}

          <div className="flex gap-2 pt-1">
            <Input placeholder="Add work item..." value={newItemName} onChange={(e) => setNewItemName(e.target.value)} className="h-8 text-sm flex-1" onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addNew(); } }} />
            <Button type="button" size="sm" variant="outline" className="h-8" disabled={!newItemName.trim()} onClick={addNew}>
              <Plus className="h-3 w-3 mr-1" />Add
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
