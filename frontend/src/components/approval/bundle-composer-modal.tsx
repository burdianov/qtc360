"use client";

import { useState, useMemo, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { GripVertical, Trash2, FileText, Loader2 } from "lucide-react";
import Image from "next/image";
import { toast } from "sonner";
import {
  DndContext,
  DragOverlay,
  useDraggable,
  useDroppable,
  PointerSensor,
  useSensor,
  useSensors,
  MeasuringStrategy,
  type DragStartEvent,
  type DragEndEvent,
} from "@dnd-kit/core";
import api from "@/lib/api";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface Attachment {
  id: string;
  name: string;
  size: number;
  kind?: string;
  insert_after_page?: number | null;
}

interface Insertion {
  attachment_id: string;
  attachment_name: string;
  insert_after_page: number;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  documentId: string;
  attachments: Attachment[];
  onComposed: () => void;
}

// Draggable attachment card
function DraggableAttachment({ att }: { att: Attachment }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: `att-${att.id}`, data: { att } });
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      className={`flex items-center gap-2 p-2 rounded-md border bg-card cursor-grab hover:bg-accent/50 transition-colors ${isDragging ? "opacity-40" : ""}`}
    >
      <GripVertical className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium truncate">{att.name}</p>
        <p className="text-[10px] text-muted-foreground">{(att.size / 1024).toFixed(0)} KB</p>
      </div>
    </div>
  );
}

// Draggable inserted attachment (can be repositioned)
function DraggableInsertion({ insertion, idx, onRemove }: { insertion: Insertion; idx: number; onRemove: () => void }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: `ins-${idx}`, data: { insertion, idx } });
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      className={`flex flex-col items-center justify-center h-32 w-20 border-2 border-dashed border-primary/50 rounded bg-primary/5 relative group cursor-grab ${isDragging ? "opacity-40" : ""}`}
    >
      <FileText className="h-5 w-5 text-primary/70" />
      <p className="text-[9px] text-center text-primary/80 px-1 mt-1 leading-tight truncate w-full">
        {insertion.attachment_name}
      </p>
      <button
        onClick={(e) => { e.stopPropagation(); onRemove(); }}
        className="absolute top-0.5 right-0.5 p-0.5 rounded bg-destructive/80 text-white opacity-0 group-hover:opacity-100 transition-opacity"
      >
        <Trash2 className="h-3 w-3" />
      </button>
    </div>
  );
}

// Drop zone between pages
function DropZone({ id, isOver }: { id: string; isOver: boolean }) {
  const { setNodeRef } = useDroppable({ id });
  return (
    <div ref={setNodeRef} className={`flex items-stretch self-stretch w-3 mx-[-2px] z-10 transition-all ${isOver ? "w-4" : ""}`}>
      <div className={`w-1 mx-auto rounded-full transition-all ${isOver ? "bg-primary w-1.5" : "bg-transparent hover:bg-border"}`} />
    </div>
  );
}

export function BundleComposerModal({ open, onOpenChange, documentId, attachments, onComposed }: Props) {
  const [insertions, setInsertions] = useState<Insertion[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [overDropZone, setOverDropZone] = useState<string | null>(null);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  useEffect(() => {
    if (open) { setInsertions([]); setActiveId(null); setOverDropZone(null); }
  }, [open]);

  const { data, isLoading } = useQuery<{ page_count: number; thumbnails: string[] }>({
    queryKey: ["bundle-pages", documentId],
    queryFn: async () => (await api.get(`/reports/bundle-pages/${documentId}`)).data,
    enabled: open && !!documentId,
  });

  const thumbnails = useMemo(() => data?.thumbnails ?? [], [data?.thumbnails]);
  const pageCount = data?.page_count ?? 0;

  const attachmentIds = useMemo(() => new Set(attachments.map((a) => a.id)), [attachments]);
  const validInsertions = useMemo(() => insertions.filter((i) => attachmentIds.has(i.attachment_id)), [insertions, attachmentIds]);
  const insertedIds = useMemo(() => new Set(validInsertions.map((i) => i.attachment_id)), [validInsertions]);
  const availableAttachments = attachments.filter((a) => !insertedIds.has(a.id) && a.kind !== "checklist");

  const stripItems = useMemo(() => {
    const result: Array<
      | { type: "page"; pageNum: number; thumb: string }
      | { type: "attachment"; insertion: Insertion; idx: number }
    > = [];
    for (let p = 0; p < pageCount; p++) {
      result.push({ type: "page", pageNum: p + 1, thumb: thumbnails[p] });
      validInsertions
        .map((ins, idx) => ({ ins, idx }))
        .filter(({ ins }) => ins.insert_after_page === p)
        .forEach(({ ins, idx }) => { result.push({ type: "attachment", insertion: ins, idx }); });
    }
    return result;
  }, [pageCount, thumbnails, validInsertions]);

  const removeInsertion = (idx: number) => setInsertions((prev) => prev.filter((_, i) => i !== idx));

  const handleDragStart = (event: DragStartEvent) => setActiveId(String(event.active.id));
  const handleDragOver = (event: any) => setOverDropZone(event.over?.id ? String(event.over.id) : null);

  const handleDragEnd = (event: DragEndEvent) => {
    setActiveId(null);
    setOverDropZone(null);
    const { active, over } = event;
    if (!over || !String(over.id).startsWith("drop-")) return;

    const afterPage = parseInt(String(over.id).replace("drop-", ""));
    const activeData = active.data.current;

    if (activeData?.att) {
      // New insertion from left panel
      const att = activeData.att as Attachment;
      setInsertions((prev) => [...prev, { attachment_id: att.id, attachment_name: att.name, insert_after_page: afterPage }]);
    } else if (activeData?.insertion) {
      // Repositioning existing insertion
      const idx = activeData.idx as number;
      setInsertions((prev) => {
        const item = prev[idx];
        if (!item) return prev;
        return [...prev.filter((_, i) => i !== idx), { ...item, insert_after_page: afterPage }];
      });
    }
  };

  const composeMutation = useMutation({
    mutationFn: async () => {
      await api.post(`/reports/bundle-compose/${documentId}`, {
        insertions: validInsertions.map((i) => ({ attachment_id: i.attachment_id, insert_after_page: i.insert_after_page })),
      });
    },
    onSuccess: () => { toast.success("Bundle composed successfully"); onComposed(); onOpenChange(false); },
    onError: () => { toast.error("Failed to compose bundle"); },
  });

  // Active item for drag overlay
  const activeAtt = activeId?.startsWith("att-") ? attachments.find((a) => a.id === activeId.replace("att-", "")) : null;
  const activeIns = activeId?.startsWith("ins-") ? validInsertions[parseInt(activeId.replace("ins-", ""))] : null;

  return (
    <DndContext
      sensors={sensors}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
      measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}
    >
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="6xl" className="max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Compose Bundle for Approver 2</DialogTitle>
          <DialogDescription>
            Drag attachments from the left and drop them between pages.
          </DialogDescription>
        </DialogHeader>

          <div className="flex-1 overflow-hidden flex gap-4 min-h-0">
            {/* Left: Available attachments */}
            <div className="w-48 shrink-0 border rounded-lg p-3 space-y-2 overflow-y-auto">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Attachments</p>
              {availableAttachments.length === 0 ? (
                <p className="text-xs text-muted-foreground italic">All attachments placed</p>
              ) : (
                availableAttachments.map((att) => <DraggableAttachment key={att.id} att={att} />)
              )}
            </div>

            {/* Right: Page strip with drop zones */}
            <div className="flex-1 overflow-auto border rounded-lg p-3">
              {isLoading ? (
                <div className="flex items-center justify-center h-full">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : (
                <div className="flex flex-wrap items-start gap-y-3">
                  {stripItems.map((item) => {
                    if (item.type === "page") {
                      const pageIdx = item.pageNum - 1;
                      return (
                        <div key={`p-${item.pageNum}`} className="flex items-stretch">
                          {pageIdx === 0 && <DropZone id={`drop--1`} isOver={overDropZone === "drop--1"} />}
                          <div className="relative border rounded overflow-hidden">
                            <Image src={`data:image/png;base64,${item.thumb}`} alt={`Page ${item.pageNum}`} width={128} height={128} className="h-32 w-auto" />
                            <span className="absolute bottom-0.5 right-1 text-[9px] bg-black/60 text-white px-1 rounded">{item.pageNum}</span>
                          </div>
                          <DropZone id={`drop-${pageIdx}`} isOver={overDropZone === `drop-${pageIdx}`} />
                        </div>
                      );
                    } else {
                      return <DraggableInsertion key={`ins-${item.idx}`} insertion={item.insertion} idx={item.idx} onRemove={() => removeInsertion(item.idx)} />;
                    }
                  })}
                </div>
              )}
            </div>
          </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={() => composeMutation.mutate()} disabled={composeMutation.isPending || validInsertions.length === 0}>
            {composeMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Compose Bundle ({validInsertions.length} attachment{validInsertions.length !== 1 ? "s" : ""})
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

      <DragOverlay dropAnimation={null}>
        {activeAtt && (
          <div className="flex items-center gap-2 p-2 rounded-md border bg-card shadow-lg opacity-90 w-44">
            <FileText className="h-4 w-4 text-primary shrink-0" />
            <p className="text-xs font-medium truncate">{activeAtt.name}</p>
          </div>
        )}
        {activeIns && (
          <div className="flex flex-col items-center justify-center h-32 w-20 border-2 border-dashed border-primary rounded bg-primary/10 shadow-lg opacity-90">
            <FileText className="h-5 w-5 text-primary" />
            <p className="text-[9px] text-center text-primary px-1 mt-1 truncate w-full">{activeIns.attachment_name}</p>
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
}
