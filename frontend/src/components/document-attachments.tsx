"use client";

import { useState } from "react";
import { GripVertical, Trash2, Download, Edit2 } from "lucide-react";
import { useMutation } from "@tanstack/react-query";
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

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import api from "@/lib/api";
import { MAX_ATTACHMENT_BYTES } from "@/lib/constants";
import { filterBySize, formatSizeCap } from "@/lib/upload";

interface Attachment {
  id?: string;
  file?: File;
  name: string;
  size: number;
  isExisting?: boolean;
  insert_after_page?: number | null;
  kind?: string;
}

interface Props {
  documentId?: string;
  attachments: Attachment[];
  onAttachmentsChange: (attachments: Attachment[]) => void;
  onDirtyChange?: () => void;
  showPagePosition?: boolean;
  showDownloadBundle?: boolean;
}

function SortableAttachmentRow({
  att,
  index,
  showPagePosition,
  onEditPagePosition,
  onDelete,
}: {
  att: Attachment;
  index: number;
  showPagePosition: boolean;
  onEditPagePosition: (i: number) => void;
  onDelete: (i: number) => void;
}) {
  const sortId = att.id || `new-${index}`;
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: sortId });
  const style = { transform: CSS.Transform.toString(transform), transition };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="flex items-center gap-2 rounded-md border bg-card p-2 hover:bg-accent/30"
    >
      <button {...attributes} {...listeners} className="cursor-grab text-muted-foreground hover:text-foreground">
        <GripVertical className="h-4 w-4" />
      </button>
      <div className="flex-1 min-w-0">
        <div className="text-sm truncate">{att.name}</div>
        <div className="text-xs text-muted-foreground">
          {(att.size / 1024).toFixed(1)} KB
          {att.kind === "checklist" && <span className="ml-2 text-primary">• Checklist</span>}
          {showPagePosition &&
            att.insert_after_page !== undefined &&
            att.insert_after_page !== null && (
              <span className="ml-2">• Insert after page {att.insert_after_page}</span>
            )}
        </div>
      </div>
      {showPagePosition && (
        <Button type="button" size="sm" variant="ghost" className="h-7 px-2" onClick={() => onEditPagePosition(index)}>
          <Edit2 className="h-3.5 w-3.5" />
        </Button>
      )}
      <Button
        type="button"
        size="sm"
        variant="ghost"
        className="h-7 px-2 text-red-500 hover:text-red-600 hover:bg-red-500/10"
        onClick={() => onDelete(index)}
      >
        <Trash2 className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}

export function DocumentAttachments({
  documentId,
  attachments,
  onAttachmentsChange,
  onDirtyChange,
  showPagePosition = false,
  showDownloadBundle = false,
}: Props) {
  const [editingPagePosition, setEditingPagePosition] = useState<number | null>(null);
  const [pagePositionValue, setPagePositionValue] = useState("");
  const [confirmDeleteIndex, setConfirmDeleteIndex] = useState<number | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const handleAddAttachments = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = true;
    input.accept = ".pdf,.png,.jpg,.jpeg";
    input.onchange = (e) => {
      const files = (e.target as HTMLInputElement).files;
      if (!files || files.length === 0) return;
      const accepted = filterBySize(Array.from(files), MAX_ATTACHMENT_BYTES, "Attachment");
      if (accepted.length === 0) return;
      onAttachmentsChange([
        ...attachments,
        ...accepted.map((f) => ({ file: f, name: f.name, size: f.size })),
      ]);
      onDirtyChange?.();
    };
    input.click();
  };

  const handleRemove = async (index: number) => {
    const att = attachments[index];
    if (att.isExisting && att.id && documentId) {
      try {
        await api.delete(`/documents/${documentId}/attachments/${att.id}`);
        toast.success("Attachment deleted");
      } catch {
        toast.error("Failed to delete attachment");
        return;
      }
    }
    onAttachmentsChange(attachments.filter((_, i) => i !== index));
    onDirtyChange?.();
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const sortIds = attachments.map((a, i) => a.id || `new-${i}`);
    const oldIndex = sortIds.indexOf(String(active.id));
    const newIndex = sortIds.indexOf(String(over.id));
    if (oldIndex === -1 || newIndex === -1) return;
    onAttachmentsChange(arrayMove(attachments, oldIndex, newIndex));
    onDirtyChange?.();
  };

  const handleEditPagePosition = (index: number) => {
    const att = attachments[index];
    setEditingPagePosition(index);
    setPagePositionValue(att.insert_after_page?.toString() || "");
  };

  const savePagePositionMutation = useMutation({
    mutationFn: async ({ index, page }: { index: number; page: number | null }) => {
      const att = attachments[index];
      const newAttachments = [...attachments];
      newAttachments[index] = { ...att, insert_after_page: page };
      onAttachmentsChange(newAttachments);
    },
    onSuccess: () => {
      toast.success("Page position updated");
      setEditingPagePosition(null);
      onDirtyChange?.();
    },
    onError: () => {
      toast.error("Failed to update page position");
    },
  });

  const handleSavePagePosition = () => {
    if (editingPagePosition === null) return;
    const page = pagePositionValue ? parseInt(pagePositionValue) : null;
    if (pagePositionValue && (isNaN(page!) || page! < 0)) {
      toast.error("Invalid page number");
      return;
    }
    savePagePositionMutation.mutate({ index: editingPagePosition, page });
  };

  const handleDownloadBundle = () => {
    if (!documentId) return;
    window.open(`/api/v1/documents/${documentId}/bundle`, "_blank");
  };

  const sortIds = attachments.map((a, i) => a.id || `new-${i}`);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium">Attachments</h3>
        <div className="flex gap-2">
          {showDownloadBundle && documentId && attachments.length > 0 && (
            <Button type="button" size="sm" variant="outline" onClick={handleDownloadBundle}>
              <Download className="mr-1.5 h-3.5 w-3.5" />Download Bundle
            </Button>
          )}
          <Button type="button" size="sm" variant="outline" onClick={handleAddAttachments}>
            Add Files
          </Button>
        </div>
      </div>

      {attachments.length === 0 ? (
        <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
          No attachments. Click &quot;Add Files&quot; to upload.
          <br />
          <span className="text-xs">
            Accepted formats: PDF, PNG, JPG. Max {formatSizeCap(MAX_ATTACHMENT_BYTES)} per file.
          </span>
        </div>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={sortIds} strategy={verticalListSortingStrategy}>
            <div className="space-y-2">
              {attachments.map((att, i) => (
                <SortableAttachmentRow
                  key={sortIds[i]}
                  att={att}
                  index={i}
                  showPagePosition={showPagePosition}
                  onEditPagePosition={handleEditPagePosition}
                  onDelete={(idx) => setConfirmDeleteIndex(idx)}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}

      <Dialog open={confirmDeleteIndex !== null} onOpenChange={(open) => !open && setConfirmDeleteIndex(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Delete Attachment</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">
            Are you sure you want to delete &ldquo;{confirmDeleteIndex !== null ? attachments[confirmDeleteIndex]?.name : ""}&rdquo;?
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDeleteIndex(null)}>Cancel</Button>
            <Button variant="destructive" onClick={() => { handleRemove(confirmDeleteIndex!); setConfirmDeleteIndex(null); }}>Delete</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={editingPagePosition !== null} onOpenChange={(open) => !open && setEditingPagePosition(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Set Page Position</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-xs text-muted-foreground mb-1.5 block">
                Insert After Page (0-indexed, leave empty for no specific position)
              </label>
              <Input type="number" min="0" value={pagePositionValue} onChange={(e) => setPagePositionValue(e.target.value)} placeholder="e.g., 0 for after first page" />
              <p className="text-xs text-muted-foreground mt-1">
                Page numbers are 0-indexed. Enter 0 to insert after the first page, 1 for after the second page, etc.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingPagePosition(null)}>Cancel</Button>
            <Button onClick={handleSavePagePosition} disabled={savePagePositionMutation.isPending} aria-busy={savePagePositionMutation.isPending || undefined}>
              {savePagePositionMutation.isPending && <Spinner size="sm" className="mr-1 text-current" />}
              {savePagePositionMutation.isPending ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
