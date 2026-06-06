"use client";

import { type Table, type Column } from "@tanstack/react-table";
import { Settings2, GripVertical } from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Checkbox } from "@/components/ui/checkbox";

interface DataTableViewOptionsProps<TData> {
  table: Table<TData>;
}

function getColumnLabel<TData>(col: Column<TData, unknown>): string {
  const meta = col.columnDef.meta as { title?: string } | undefined;
  if (meta?.title) return meta.title;
  const header = col.columnDef.header;
  if (typeof header === "string") return header;
  return col.id
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function SortableColumnItem<TData>({
  col,
  onToggleVisibility,
}: {
  col: Column<TData, unknown>;
  onToggleVisibility: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: col.id });
  const style = { transform: CSS.Transform.toString(transform), transition };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="flex items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-accent"
    >
      <button {...attributes} {...listeners} className="cursor-grab text-muted-foreground hover:text-foreground">
        <GripVertical className="h-3.5 w-3.5" />
      </button>
      <Checkbox checked={col.getIsVisible()} onCheckedChange={onToggleVisibility} />
      <span className="truncate">{getColumnLabel(col)}</span>
    </div>
  );
}

export function DataTableViewOptions<TData>({ table }: DataTableViewOptionsProps<TData>) {
  const columns = table
    .getAllColumns()
    .filter((col) => typeof col.accessorFn !== "undefined" && col.getCanHide());

  const prefKey = typeof window !== "undefined" ? window.location.pathname.replace(/\//g, "_") : "";
  const queryClient = useQueryClient();

  const saveMutation = useMutation({
    mutationFn: async (order: string[]) => {
      await api.put(`/auth/me/preferences/col_order${prefKey}`, { order });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["user-preferences"] }),
  });

  const saveVisibility = useMutation({
    mutationFn: async (vis: Record<string, boolean>) => {
      await api.put(`/auth/me/preferences/col_vis${prefKey}`, vis);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["user-preferences"] }),
  });

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const tableOrder = table.getState().columnOrder;
  const orderedColumns = tableOrder.length > 0
    ? [...columns].sort((a, b) => tableOrder.indexOf(a.id) - tableOrder.indexOf(b.id))
    : columns;

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const currentOrder = tableOrder.length > 0
      ? [...tableOrder]
      : ["select", ...columns.map((c) => c.id), "actions"];
    const fromIdx = currentOrder.indexOf(String(active.id));
    const toIdx = currentOrder.indexOf(String(over.id));
    if (fromIdx === -1 || toIdx === -1) return;

    const newOrder = arrayMove(currentOrder, fromIdx, toIdx);
    // Keep actions at the end
    const actionsIdx = newOrder.indexOf("actions");
    if (actionsIdx !== -1 && actionsIdx !== newOrder.length - 1) {
      newOrder.splice(actionsIdx, 1);
      newOrder.push("actions");
    }
    table.setColumnOrder(newOrder);
    saveMutation.mutate(newOrder.filter((id) => id !== "select" && id !== "actions"));
  };

  return (
    <div className="flex items-center">
    <DropdownMenu>
      <DropdownMenuTrigger className="hidden h-8 lg:inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md border border-input bg-background px-3 text-sm font-medium ring-offset-background hover:bg-accent hover:text-accent-foreground">
        <Settings2 className="h-4 w-4" />
        Columns
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={8} className="w-[200px]">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Toggle & reorder</DropdownMenuLabel>
        </DropdownMenuGroup>
        <div className="space-y-0.5 p-1">
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={orderedColumns.map((c) => c.id)} strategy={verticalListSortingStrategy}>
              {orderedColumns.map((col) => (
                <SortableColumnItem
                  key={col.id}
                  col={col}
                  onToggleVisibility={() => {
                    col.toggleVisibility(!col.getIsVisible());
                    const updated: Record<string, boolean> = {};
                    columns.forEach((c) => {
                      const visible = c.id === col.id ? !col.getIsVisible() : c.getIsVisible();
                      if (!visible) updated[c.id] = false;
                    });
                    saveVisibility.mutate(updated);
                  }}
                />
              ))}
            </SortableContext>
          </DndContext>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
    </div>
  );
}
