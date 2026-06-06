"use client";

import { useState, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { GripVertical, Pencil, Plus, Trash2, Upload } from "lucide-react";
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
import api from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

interface ChecklistItem {
  id: string;
  text: string;
  sort_order: number;
}

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  templateId: string;
  templateName: string;
}

function SortableRow({ item, onDelete, onUpdate }: { item: ChecklistItem; onDelete: (id: string) => void; onUpdate: (id: string, text: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(item.text);
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: item.id });
  const style = { transform: CSS.Transform.toString(transform), transition };

  const save = () => {
    const trimmed = text.trim();
    if (trimmed && trimmed !== item.text) onUpdate(item.id, trimmed);
    setEditing(false);
  };

  return (
    <tr ref={setNodeRef} style={style} className="border-b border-border">
      <td className="w-8 px-2 py-1.5">
        <button {...attributes} {...listeners} className="cursor-grab text-muted-foreground hover:text-foreground">
          <GripVertical className="h-4 w-4" />
        </button>
      </td>
      <td className="px-2 py-1.5 text-sm group/cell" onDoubleClick={() => { setEditing(true); setText(item.text); }}>
        {editing ? (
          <input
            autoFocus
            className="w-full bg-transparent border-b border-primary outline-none text-sm py-0.5"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onBlur={save}
            onKeyDown={(e) => { if (e.key === "Enter") save(); if (e.key === "Escape") setEditing(false); }}
          />
        ) : (
          <span className="cursor-text flex items-center gap-1.5 rounded px-1 -mx-1 py-0.5 hover:bg-accent/50">
            {item.text}
            <Pencil className="h-3 w-3 text-muted-foreground opacity-0 group-hover/cell:opacity-100 shrink-0" />
          </span>
        )}
      </td>
      <td className="w-8 px-2 py-1.5">
        <button onClick={() => onDelete(item.id)} className="text-muted-foreground hover:text-destructive">
          <Trash2 className="h-4 w-4" />
        </button>
      </td>
    </tr>
  );
}

export function ChecklistItemsDialog({ open, onOpenChange, templateId, templateName }: Props) {
  const queryClient = useQueryClient();
  const [newText, setNewText] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const { data: items = [] } = useQuery<ChecklistItem[]>({
    queryKey: ["checklist-items", templateId],
    queryFn: async () => (await api.get(`/checklists/templates/${templateId}/items`)).data,
    enabled: open,
  });

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const addMutation = useMutation({
    mutationFn: (texts: string[]) =>
      api.post(`/checklists/templates/${templateId}/items`, {
        items: texts.map((text, i) => ({ text, sort_order: (items.length + i) * 10 })),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["checklist-items", templateId] });
      setNewText("");
      toast.success("Items added");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/checklists/items/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["checklist-items", templateId] });
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, text }: { id: string; text: string }) =>
      api.patch(`/checklists/items/${id}`, { text, sort_order: items.find((i) => i.id === id)?.sort_order ?? 0 }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["checklist-items", templateId] });
    },
  });

  const reorderMutation = useMutation({
    mutationFn: (reordered: { id: string; sort_order: number }[]) =>
      api.put(`/checklists/templates/${templateId}/reorder`, { items: reordered }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["checklist-items", templateId] });
    },
  });

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = items.findIndex((i) => i.id === active.id);
    const newIndex = items.findIndex((i) => i.id === over.id);
    const reordered = arrayMove(items, oldIndex, newIndex);
    reorderMutation.mutate(reordered.map((item, idx) => ({ id: item.id, sort_order: idx * 10 })));
  };

  const handleAdd = () => {
    const text = newText.trim();
    if (!text) return;
    addMutation.mutate([text]);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") { e.preventDefault(); handleAdd(); }
  };

  const handleCsvUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
      if (lines.length === 0) return;
      addMutation.mutate(lines);
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[80vh] overflow-hidden flex flex-col" size="5xl">
        <DialogHeader>
          <DialogTitle>Checklist Items - {templateName}</DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-auto min-h-0">
          {items.length > 0 ? (
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
              <SortableContext items={items.map((i) => i.id)} strategy={verticalListSortingStrategy}>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-muted-foreground">
                      <th className="w-8"></th>
                      <th className="px-2 py-1.5 text-left font-medium">Item Text</th>
                      <th className="w-8"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((item) => (
                      <SortableRow key={item.id} item={item} onDelete={(id) => deleteMutation.mutate(id)} onUpdate={(id, text) => updateMutation.mutate({ id, text })} />
                    ))}
                  </tbody>
                </table>
              </SortableContext>
            </DndContext>
          ) : (
            <p className="text-sm text-muted-foreground py-4 text-center">No checklist items yet.</p>
          )}
        </div>

        <div className="flex items-center gap-2 pt-3 border-t border-border">
          <Input
            value={newText}
            onChange={(e) => setNewText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Add checklist item..."
            className="flex-1"
          />
          <Button size="sm" onClick={handleAdd} disabled={!newText.trim()}>
            <Plus className="h-4 w-4 mr-1" />Add
          </Button>
          <Button size="sm" variant="outline" onClick={() => fileRef.current?.click()}>
            <Upload className="h-4 w-4 mr-1" />Import CSV
          </Button>
          <input ref={fileRef} type="file" accept=".csv,.txt" className="hidden" onChange={handleCsvUpload} />
        </div>
        <p className="text-xs text-muted-foreground pt-1">
          CSV format: one item per line (plain text, no headers). <button type="button" className="underline hover:text-foreground" onClick={() => {
            const sample = "Materials installed are as per approved material submittal\nPipe size & insulation is as per approved shop drawings\nInstallation & route is properly coordinated to other services";
            const blob = new Blob([sample], { type: "text/csv" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url; a.download = "checklist-items-template.csv"; a.click();
            URL.revokeObjectURL(url);
          }}>Download sample template</button>
        </p>
        <div className="flex justify-end pt-2">
          <Button onClick={() => onOpenChange(false)}>Done</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
