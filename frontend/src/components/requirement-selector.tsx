"use client";

import { useState, useRef, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Plus, X, ClipboardCheck, Eye, Download, Trash2 } from "lucide-react";
import { toast } from "sonner";
import api from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from "@/components/ui/command";
import { FillChecklistModal, type PendingChecklistData } from "@/components/fill-checklist-modal";
import { PdfPreviewModal } from "@/components/pdf-preview-modal";

interface RequirementTemplate {
  id: string;
  name: string;
  code: string;
  level_code: string;
  requirement_category: string;
  evidence_document_type: string;
  is_gate_requirement: boolean;
}

export interface SelectedRequirement {
  id: string; // client-side key
  requirementTemplateId: string;
}

export type { PendingChecklistData };

interface Props {
  projectId: string;
  documentType: string;
  documentId?: string;
  applicableTemplateIds: Set<string> | null;
  selectedRequirements: SelectedRequirement[];
  onRequirementsChange: (reqs: SelectedRequirement[]) => void;
  pendingChecklists: Map<string, PendingChecklistData>;
  onPendingChecklistsChange: (map: Map<string, PendingChecklistData>) => void;
}

function reqId() {
  return Math.random().toString(36).slice(2);
}

export function RequirementSelector({
  projectId,
  documentType,
  documentId,
  applicableTemplateIds,
  selectedRequirements,
  onRequirementsChange,
  pendingChecklists,
  onPendingChecklistsChange,
}: Props) {
  const [addOpen, setAddOpen] = useState(false);
  const [fillModalOpen, setFillModalOpen] = useState<string | null>(null); // requirementTemplateId
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  // Prevent page scroll when cmdk CommandInput auto-focuses inside the popover
  const scrollYRef = useRef(0);
  useEffect(() => {
    if (addOpen) {
      scrollYRef.current = window.scrollY;
      // Restore after cmdk's internal useEffect focuses the input (effect order: parent first)
      const raf = requestAnimationFrame(() => window.scrollTo(0, scrollYRef.current));
      const id = setTimeout(() => window.scrollTo(0, scrollYRef.current), 0);
      return () => { cancelAnimationFrame(raf); clearTimeout(id); };
    }
  }, [addOpen]);

  const { data: templates = [] } = useQuery<RequirementTemplate[]>({
    queryKey: ["requirement-templates", projectId, documentType],
    queryFn: async () => {
      const res = await api.get("/commissioning/requirement-templates", {
        params: { project_id: projectId },
      });
      return (res.data as RequirementTemplate[]).filter(
        (t) => t.evidence_document_type === documentType,
      );
    },
    enabled: !!projectId,
  });

  const filteredTemplates = applicableTemplateIds
    ? templates.filter((t) => applicableTemplateIds.has(t.id))
    : [];

  const disciplineSelected = applicableTemplateIds !== null;

  const selectedTemplateIds = new Set(
    selectedRequirements.map((r) => r.requirementTemplateId),
  );

  const availableTemplates = filteredTemplates.filter(
    (t) => !selectedTemplateIds.has(t.id),
  );

  const handleAdd = (templateId: string) => {
    onRequirementsChange([
      ...selectedRequirements,
      { id: reqId(), requirementTemplateId: templateId },
    ]);
    setAddOpen(false);
  };

  const handleRemove = (reqId: string) => {
    const req = selectedRequirements.find((r) => r.id === reqId);
    if (!req) return;

    // Remove pending checklist if any
    if (pendingChecklists.has(req.requirementTemplateId)) {
      const next = new Map(pendingChecklists);
      next.delete(req.requirementTemplateId);
      onPendingChecklistsChange(next);
    }

    // Remove saved checklist from backend if document exists
    if (documentId) {
      api
        .delete(
          `/checklists/documents/${documentId}/${req.requirementTemplateId}`,
        )
        .catch((err: any) =>
          console.error("Failed to delete checklist:", err),
        );
    }

    onRequirementsChange(selectedRequirements.filter((r) => r.id !== reqId));
  };

  const handleChecklistSaved = (requirementTemplateId: string) => {
    // Remove from pending if it was there, since it's now saved to backend
    if (pendingChecklists.has(requirementTemplateId)) {
      const next = new Map(pendingChecklists);
      next.delete(requirementTemplateId);
      onPendingChecklistsChange(next);
    }
  };

  const handlePreviewChecklist = async (requirementTemplateId: string) => {
    if (!documentId) {
      toast.info("Save the document first to preview the checklist PDF");
      return;
    }
    try {
      const res = await api.get(
        `/checklists/documents/${documentId}/${requirementTemplateId}/pdf`,
        { responseType: "blob" },
      );
      const url = URL.createObjectURL(res.data);
      setPreviewUrl(url);
    } catch {
      toast.error("Failed to preview checklist");
    }
  };

  const handleDownloadChecklist = async (
    requirementTemplateId: string,
    requirementName: string,
  ) => {
    if (!documentId) {
      toast.info("Save the document first to download the checklist PDF");
      return;
    }
    try {
      const res = await api.get(
        `/checklists/documents/${documentId}/${requirementTemplateId}/pdf`,
        { responseType: "blob" },
      );
      const url = URL.createObjectURL(res.data);
      const a = document.createElement("a");
      a.href = url;
      a.download = `Checklist - ${requirementName}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      toast.error("Failed to download checklist");
    }
  };

  const handleRemoveChecklist = async (requirementTemplateId: string) => {
    if (!documentId) {
      // Just remove from pending
      const next = new Map(pendingChecklists);
      next.delete(requirementTemplateId);
      onPendingChecklistsChange(next);
      return;
    }
    try {
      await api.delete(
        `/checklists/documents/${documentId}/${requirementTemplateId}`,
      );
      toast.success("Checklist removed");
    } catch {
      toast.error("Failed to remove checklist");
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium">Requirements</p>
          <p className="text-xs text-muted-foreground">
            Select requirements for this {documentType}
          </p>
        </div>
        <Popover open={addOpen} onOpenChange={setAddOpen}>
          <PopoverTrigger
            render={
              <Button
                variant="outline"
                size="sm"
                className="h-8 text-xs gap-1.5"
                disabled={availableTemplates.length === 0}
              >
                <Plus className="h-3.5 w-3.5" />
                Add Requirement
              </Button>
            }
          />
          <PopoverContent
            className="w-[440px] p-0"
            align="start"
            sideOffset={4}
          >
            <Command>
              <CommandInput
                placeholder="Search requirements..."
                className="h-9"
              />
              <CommandList>
                <CommandEmpty>No requirements found</CommandEmpty>
                <CommandGroup>
                  {availableTemplates.map((t) => (
                    <CommandItem
                      key={t.id}
                      value={t.id}
                      keywords={[t.code, t.requirement_category, t.level_code]}
                      onSelect={() => handleAdd(t.id)}
                    >
                      <span className="flex items-center gap-2 w-full min-w-0">
                        <span className="font-mono text-xs text-muted-foreground shrink-0">
                          [{t.level_code}]
                        </span>
                        <span className="truncate flex-1 min-w-0">
                          {t.name}
                        </span>
                        <Badge
                          variant="outline"
                          className="text-[10px] shrink-0 ml-2"
                        >
                          {t.requirement_category}
                        </Badge>
                      </span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
      </div>

      {selectedRequirements.length > 0 && (
        <div className="space-y-2">
          {selectedRequirements
            .filter((req) => req.requirementTemplateId != null)
            .map((req) => {
            const template = templates.find(
              (t) => t.id === req.requirementTemplateId,
            );
            const name = template
              ? `[${template.level_code}] ${template.name}`
              : req.requirementTemplateId.slice(0, 8);
            const hasChecklist = documentId
              ? undefined // will be checked via query in child
              : pendingChecklists.has(req.requirementTemplateId);
            const pendingData = pendingChecklists.get(
              req.requirementTemplateId,
            );

            return (
              <div
                key={req.id}
                className="flex items-center gap-2 rounded-lg border px-3 py-2.5"
              >
                {/* Requirement label */}
                <div className="flex-1 min-w-0">
                  <span className="text-sm font-medium truncate block">
                    {name}
                  </span>
                  {template && (
                    <span className="text-xs text-muted-foreground">
                      {template.requirement_category}
                      {template.is_gate_requirement && " • Gate"}
                    </span>
                  )}
                </div>

                {/* Checklist buttons */}
                <div className="flex items-center gap-1.5 shrink-0">
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs"
                    onClick={() =>
                      setFillModalOpen(req.requirementTemplateId)
                    }
                  >
                    <ClipboardCheck className="h-3.5 w-3.5 mr-1" />
                    {documentId
                      ? hasChecklist
                        ? "Edit Checklist"
                        : "Fill Checklist"
                      : pendingChecklists.has(req.requirementTemplateId)
                        ? "Edit Checklist"
                        : "Fill Checklist"}
                  </Button>

                  {/* Action buttons — show when checklist exists (backend or pending) */}
                  {(documentId || pendingChecklists.has(req.requirementTemplateId)) && (
                    <ChecklistActionButtons
                      documentId={documentId || ""}
                      requirementTemplateId={req.requirementTemplateId}
                      requirementName={template?.name || ""}
                      forceShow={!documentId && pendingChecklists.has(req.requirementTemplateId)}
                      onPreview={() =>
                        handlePreviewChecklist(req.requirementTemplateId)
                      }
                      onDownload={() =>
                        handleDownloadChecklist(
                          req.requirementTemplateId,
                          template?.name || "",
                        )
                      }
                      onRemove={() =>
                        handleRemoveChecklist(req.requirementTemplateId)
                      }
                    />
                  )}

                  {/* Remove requirement */}
                  <button
                    type="button"
                    className="p-1.5 rounded-md hover:bg-destructive/10 text-muted-foreground hover:text-destructive ml-1"
                    onClick={() => handleRemove(req.id)}
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>

                {/* Fill checklist modal */}
                <FillChecklistModal
                  open={fillModalOpen === req.requirementTemplateId}
                  onOpenChange={(v) => {
                    if (!v) setFillModalOpen(null);
                  }}
                  documentId={documentId || ""}
                  requirementTemplateId={req.requirementTemplateId}
                  requirementName={template?.name || ""}
                  pendingData={pendingData || null}
                  onSaveLocally={
                    !documentId
                      ? (data) => {
                          const next = new Map(pendingChecklists);
                          next.set(req.requirementTemplateId, data);
                          onPendingChecklistsChange(next);
                          setFillModalOpen(null);
                        }
                      : undefined
                  }
                  onSaved={
                    documentId
                      ? () => handleChecklistSaved(req.requirementTemplateId)
                      : undefined
                  }
                />
              </div>
            );
          })}
        </div>
      )}

      {filteredTemplates.length === 0 && (
        <p className="text-xs text-muted-foreground">
          {disciplineSelected
            ? `No ${documentType} requirement templates found for the selected discipline.`
            : "Select a discipline to add requirements."}
        </p>
      )}

      <PdfPreviewModal
        open={!!previewUrl}
        onOpenChange={(o) => {
          if (!o) {
            if (previewUrl) URL.revokeObjectURL(previewUrl);
            setPreviewUrl(null);
          }
        }}
        pdfUrl={previewUrl}
        title="Checklist Preview"
      />
    </div>
  );
}

/** Shows Preview / Download / Remove buttons when checklist exists on server or pending */
function ChecklistActionButtons({
  documentId,
  requirementTemplateId,
  requirementName: _requirementName,
  onPreview,
  onDownload,
  onRemove,
  forceShow,
}: {
  documentId: string;
  requirementTemplateId: string;
  requirementName: string;
  onPreview: () => void;
  onDownload: () => void;
  onRemove: () => void;
  forceShow?: boolean;
}) {
  const { data: checklists = [] } = useQuery<any[]>({
    queryKey: ["document-checklists", documentId],
    queryFn: async () =>
      (await api.get(`/checklists/documents/${documentId}`)).data,
    enabled: !!documentId,
  });

  const existing = checklists.find(
    (c: any) => c.requirement_template_id === requirementTemplateId,
  );

  if (!existing && !forceShow) return null;

  return (
    <>
      <Button
        size="sm"
        variant="outline"
        className="h-7 text-xs"
        onClick={onPreview}
      >
        <Eye className="h-3.5 w-3.5 mr-1" />
        View PDF
      </Button>
      <Button
        size="sm"
        variant="outline"
        className="h-7 text-xs"
        onClick={onDownload}
      >
        <Download className="h-3.5 w-3.5 mr-1" />
        Download
      </Button>
      <Button
        size="sm"
        variant="outline"
        className="h-7 text-xs text-destructive hover:text-destructive"
        onClick={onRemove}
      >
        <Trash2 className="h-3.5 w-3.5 mr-1" />
        Remove
      </Button>
    </>
  );
}
