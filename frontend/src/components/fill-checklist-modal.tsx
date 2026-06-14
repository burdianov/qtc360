"use client";

import { useState, useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, Check, X } from "lucide-react";
import api from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";

interface ChecklistItem {
  id: string;
  text: string;
  sort_order: number;
}

interface ResponseState {
  checklist_item_id: string;
  item_text: string;
  response: "" | "yes" | "no";
  notes: string;
}

export interface PendingChecklistData {
  requirementTemplateId: string;
  comments: string;
  responses: {
    checklist_item_id: string;
    response: "yes" | "no";
    notes: string | null;
    display_order: number;
    item_text: string;
  }[];
}

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  documentId: string;
  requirementTemplateId: string;
  requirementName: string;
  onSaved?: () => void;
  /** Pre-populated pending data (when doc hasn't been saved yet) */
  pendingData?: PendingChecklistData | null;
  /** Called instead of API save when doc hasn't been saved yet — stores data locally */
  onSaveLocally?: (data: PendingChecklistData) => void;
}

function SortableChecklistRow({
  item,
  index,
  response,
  notes,
  onResponseChange,
  onNotesChange,
}: {
  item: ResponseState;
  index: number;
  response: "" | "yes" | "no";
  notes: string;
  onResponseChange: (value: "yes" | "no") => void;
  onNotesChange: (value: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: item.checklist_item_id });
  const style = { transform: CSS.Transform.toString(transform), transition };

  // Prevent dnd-kit PointerSensor from intercepting clicks on response buttons
  const handlePointerDown = (e: React.PointerEvent) => {
    e.stopPropagation();
  };

  return (
    <tr ref={setNodeRef} style={style} className="border-b border-border">
      <td className="w-8 px-1 py-2 text-center">
        <button {...attributes} {...listeners} className="cursor-grab text-muted-foreground hover:text-foreground">
          <GripVertical className="h-3.5 w-3.5" />
        </button>
      </td>
      <td className="w-10 px-2 py-2 text-center text-sm text-muted-foreground">{index + 1}</td>
      <td className="px-2 py-2 text-sm">{item.item_text}</td>
      <td className="w-12 text-center py-2">
        <button
          type="button"
          onPointerDown={handlePointerDown}
          onClick={() => onResponseChange("yes")}
          className={`h-7 w-7 rounded-full border-2 inline-flex items-center justify-center transition-colors ${response === "yes" ? "border-emerald-500 bg-emerald-500/15 text-emerald-500" : "border-muted-foreground/30 hover:border-emerald-500/50 text-muted-foreground"}`}
        >
          <Check className={`h-3.5 w-3.5 transition-opacity ${response === "yes" ? "opacity-100" : "opacity-0"}`} />
        </button>
      </td>
      <td className="w-12 text-center py-2">
        <button
          type="button"
          onPointerDown={handlePointerDown}
          onClick={() => onResponseChange("no")}
          className={`h-7 w-7 rounded-full border-2 inline-flex items-center justify-center transition-colors ${response === "no" ? "border-red-500 bg-red-500/15 text-red-500" : "border-muted-foreground/30 hover:border-red-500/50 text-muted-foreground"}`}
        >
          <X className={`h-3.5 w-3.5 transition-opacity ${response === "no" ? "opacity-100" : "opacity-0"}`} />
        </button>
      </td>
      <td className="py-1.5 pr-2">
        <input
          type="text"
          value={notes}
          onChange={(e) => onNotesChange(e.target.value)}
          onPointerDown={handlePointerDown}
          className="w-full rounded border border-border bg-transparent px-2 py-1 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
        />
      </td>
    </tr>
  );
}

const EMPTY_ARR: never[] = [];

export function FillChecklistModal({ open, onOpenChange, documentId, requirementTemplateId, requirementName, onSaved, pendingData, onSaveLocally }: Props) {
  const queryClient = useQueryClient();
  const [responses, setResponses] = useState<ResponseState[]>([]);
  const [comments, setComments] = useState("");

  // Snapshot of the original state when the modal opens — used to detect
  // whether the user has made any changes so we can disable Save when dirty.
  const [initialSnapshot, setInitialSnapshot] = useState<{ comments: string; responses: ResponseState[] } | null>(null);

  const isPendingMode = !documentId && !!onSaveLocally;

  // Load master checklist items
  const { data: masterItems = EMPTY_ARR, isLoading: masterLoading } = useQuery<ChecklistItem[]>({
    queryKey: ["checklist-items", requirementTemplateId],
    queryFn: async () => (await api.get(`/checklists/templates/${requirementTemplateId}/items`)).data,
    enabled: open && !!requirementTemplateId,
  });

  // Load existing saved checklist for this doc+requirement (only when doc exists)
  const { data: existingChecklists = EMPTY_ARR, isLoading: existingLoading } = useQuery<any[]>({
    queryKey: ["document-checklists", documentId],
    queryFn: async () => (await api.get(`/checklists/documents/${documentId}`)).data,
    enabled: open && !!documentId,
  });

  const isLoading = (open && !!requirementTemplateId && masterLoading) || (open && !!documentId && existingLoading);

  // Initialize responses from master items, existing data, or pending data
  useEffect(() => {
    if (!open || masterItems.length === 0) return;

    let initialComments = "";
    let initialResponses: ResponseState[] = [];

    // Check pending data first (for unsaved documents)
    if (pendingData && isPendingMode) {
      initialComments = pendingData.comments || "";
      initialResponses = pendingData.responses.map((r: any) => ({
        checklist_item_id: r.checklist_item_id,
        item_text: r.item_text,
        response: r.response,
        notes: r.notes || "",
      }));
    } else if (documentId) {
      // Check existing saved data
      const existing = existingChecklists.find((c: any) => c.requirement_template_id === requirementTemplateId);
      if (existing) {
        initialComments = existing.comments || "";
        initialResponses = existing.responses
          .sort((a: any, b: any) => a.display_order - b.display_order)
          .map((r: any) => ({
            checklist_item_id: r.checklist_item_id,
            item_text: r.item_text,
            response: r.response,
            notes: r.notes || "",
          }));
      }
    }

    if (initialResponses.length === 0) {
      // Fresh start from master items
      initialResponses = masterItems.map((item) => ({
        checklist_item_id: item.id,
        item_text: item.text,
        response: "" as const,
        notes: "",
      }));
      initialComments = "";
    }

    setComments(initialComments);
    setResponses(initialResponses);
    // Capture snapshot for dirty detection
    setInitialSnapshot({
      comments: initialComments,
      responses: [...initialResponses],
    });
  }, [open, masterItems, existingChecklists, requirementTemplateId, pendingData, isPendingMode, documentId]);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = responses.findIndex((r) => r.checklist_item_id === active.id);
    const newIndex = responses.findIndex((r) => r.checklist_item_id === over.id);
    setResponses(arrayMove(responses, oldIndex, newIndex));
  };

  const saveMutation = useMutation({
    mutationFn: async (): Promise<any> => {
      if (isPendingMode) {
        // Save locally — no API call
        onSaveLocally!({
          requirementTemplateId,
          comments: comments || "",
          responses: responses.map((r, idx) => ({
            checklist_item_id: r.checklist_item_id,
            response: r.response as "yes" | "no",
            notes: r.notes || null,
            display_order: idx,
            item_text: r.item_text,
          })),
        });
        return;
      }
      return api.post("/checklists/documents", {
        document_id: documentId,
        requirement_template_id: requirementTemplateId,
        comments: comments || null,
        responses: responses.map((r, idx) => ({
          checklist_item_id: r.checklist_item_id,
          response: r.response as "yes" | "no",
          notes: r.notes || null,
          display_order: idx,
          item_text: r.item_text,
        })),
      });
    },
    onSuccess: () => {
      if (!isPendingMode) {
        queryClient.invalidateQueries({ queryKey: ["document-checklists", documentId] });
        queryClient.invalidateQueries({ queryKey: ["document-attachments", documentId] });
      }
      toast.success("Checklist saved");
      onSaved?.();
      onOpenChange(false);
    },
    onError: () => toast.error("Failed to save checklist"),
  });

  const allAnswered = responses.length > 0 && responses.every((r) => r.response !== "" || r.notes.trim() !== "");

  // Disable Save when nothing has changed since the modal opened
  const isDirty =
    initialSnapshot &&
    (initialSnapshot.comments !== comments ||
      initialSnapshot.responses.length !== responses.length ||
      initialSnapshot.responses.some(
        (r, i) =>
          r.checklist_item_id !== responses[i]?.checklist_item_id ||
          r.response !== responses[i]?.response ||
          r.notes !== responses[i]?.notes,
      ));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-hidden flex flex-col" size="5xl">
        <DialogHeader>
          <DialogTitle>Fill Checklist - {requirementName}</DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-auto min-h-0 border border-border rounded-md">
          {isLoading ? (
            <div className="flex items-center justify-center py-16">
              <Spinner size="default" className="text-muted-foreground" />
            </div>
          ) : responses.length === 0 ? (
            <p className="text-sm text-muted-foreground p-4 text-center">No checklist items defined for this requirement.</p>
          ) : (
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
              <SortableContext items={responses.map((r) => r.checklist_item_id)} strategy={verticalListSortingStrategy}>
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-muted/80 backdrop-blur-sm z-10">
                    <tr className="border-b border-border">
                      <th className="w-8"></th>
                      <th className="w-10 px-2 py-2 text-center font-medium text-muted-foreground text-xs">SN</th>
                      <th className="px-2 py-2 text-left font-medium text-muted-foreground text-xs">Activities / Items to be Inspected</th>
                      <th className="w-12 text-center py-2 font-medium text-muted-foreground text-xs">YES</th>
                      <th className="w-12 text-center py-2 font-medium text-muted-foreground text-xs">NO</th>
                      <th className="py-2 pr-2 text-left font-medium text-muted-foreground text-xs">Notes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {responses.map((item, idx) => (
                      <SortableChecklistRow
                        key={item.checklist_item_id}
                        item={item}
                        index={idx}
                        response={item.response}
                        notes={item.notes}
                        onResponseChange={(value) => {
                          setResponses((prev) =>
                            prev.map((r) =>
                              r.checklist_item_id === item.checklist_item_id
                                ? { ...r, response: value }
                                : r
                            )
                          );
                        }}
                        onNotesChange={(value) => {
                          setResponses((prev) =>
                            prev.map((r) =>
                              r.checklist_item_id === item.checklist_item_id
                                ? { ...r, notes: value }
                                : r
                            )
                          );
                        }}
                      />
                    ))}
                  </tbody>
                </table>
              </SortableContext>
            </DndContext>
          )}
        </div>

        <div className="space-y-2 pt-2">
          <label className="text-sm font-medium text-muted-foreground">Comments / Remarks (optional)</label>
          <Textarea
            value={comments}
            onChange={(e) => setComments(e.target.value)}
            placeholder="Enter comments or remarks..."
            rows={2}
          />
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            onClick={() => saveMutation.mutate()}
            disabled={!isDirty || !allAnswered || saveMutation.isPending}
          >
            {saveMutation.isPending && <Spinner size="sm" className="text-current mr-1" />}
            Save Checklist
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
