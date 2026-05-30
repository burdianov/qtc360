"use client";

import { useState } from "react";
import { type Table, type Column } from "@tanstack/react-table";
import { Settings2, GripVertical } from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
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

  const [draggedItem, setDraggedItem] = useState<string | null>(null);

  // Get current order from table state (synced with header drag)
  const tableOrder = table.getState().columnOrder;
  const orderedColumns = tableOrder.length > 0
    ? [...columns].sort((a, b) => tableOrder.indexOf(a.id) - tableOrder.indexOf(b.id))
    : columns;

  const handleDragOver = (e: React.DragEvent, targetId: string) => {
    e.preventDefault();
    if (!draggedItem || draggedItem === targetId) return;
    const currentOrder = tableOrder.length > 0
      ? [...tableOrder]
      : ["select", ...columns.map((c) => c.id), "actions"];
    const fromIdx = currentOrder.indexOf(draggedItem);
    const toIdx = currentOrder.indexOf(targetId);
    if (fromIdx === -1 || toIdx === -1) return;
    currentOrder.splice(fromIdx, 1);
    currentOrder.splice(toIdx, 0, draggedItem);
    const actionsIdx = currentOrder.indexOf("actions");
    if (actionsIdx !== -1 && actionsIdx !== currentOrder.length - 1) {
      currentOrder.splice(actionsIdx, 1);
      currentOrder.push("actions");
    }
    table.setColumnOrder(currentOrder);
  };

  const handleDragEnd = () => {
    setDraggedItem(null);
    const order = table.getState().columnOrder.filter((id) => id !== "select" && id !== "actions");
    saveMutation.mutate(order);
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
          {orderedColumns.map((col) => (
            <div
              key={col.id}
              draggable
              onDragStart={() => setDraggedItem(col.id)}
              onDragOver={(e) => handleDragOver(e, col.id)}
              onDragEnd={handleDragEnd}
              className={`flex items-center gap-2 rounded px-2 py-1.5 text-sm cursor-grab active:cursor-grabbing hover:bg-accent ${draggedItem === col.id ? "opacity-50" : ""}`}
            >
              <GripVertical className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              <Checkbox
                checked={col.getIsVisible()}
                onCheckedChange={() => {
                  col.toggleVisibility(!col.getIsVisible());
                  // Save visibility state after toggle
                  const updated: Record<string, boolean> = {};
                  columns.forEach((c) => {
                    const visible = c.id === col.id ? !col.getIsVisible() : c.getIsVisible();
                    if (!visible) updated[c.id] = false;
                  });
                  saveVisibility.mutate(updated);
                }}
              />
              <span className="truncate">{getColumnLabel(col)}</span>
            </div>
          ))}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
    </div>
  );
}
