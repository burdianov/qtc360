"use client";

import { useState, useEffect } from "react";
import { type Table, type Column } from "@tanstack/react-table";
import { Settings2, GripVertical } from "lucide-react";
import { Button } from "@/components/ui/button";
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
  storageKey?: string;
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

export function DataTableViewOptions<TData>({ table, storageKey }: DataTableViewOptionsProps<TData>) {
  const columns = table
    .getAllColumns()
    .filter((col) => typeof col.accessorFn !== "undefined" && col.getCanHide());

  const autoKey = typeof window !== "undefined" ? `col_order_${window.location.pathname}` : null;
  const lsKey = storageKey ? `col_order_${storageKey}` : autoKey;

  const [columnOrder, setColumnOrder] = useState<string[]>(() => {
    if (lsKey && typeof window !== "undefined") {
      const saved = localStorage.getItem(lsKey);
      if (saved) try { return JSON.parse(saved); } catch {}
    }
    return columns.map((c) => c.id);
  });
  const [draggedItem, setDraggedItem] = useState<string | null>(null);

  // Apply saved order on mount
  useEffect(() => {
    if (lsKey) {
      const saved = localStorage.getItem(lsKey);
      if (saved) {
        try {
          const order: string[] = JSON.parse(saved);
          // Ensure select is first, actions is last
          const filtered = order.filter((id) => id !== "select" && id !== "actions");
          const full = ["select", ...filtered, "actions"];
          table.setColumnOrder(full);
        } catch {}
      }
    }
  }, []);

  const orderedColumns = [...columns].sort(
    (a, b) => columnOrder.indexOf(a.id) - columnOrder.indexOf(b.id)
  );

  const handleDragStart = (id: string) => {
    setDraggedItem(id);
  };

  const handleDragOver = (e: React.DragEvent, targetId: string) => {
    e.preventDefault();
    if (!draggedItem || draggedItem === targetId) return;
    const newOrder = [...columnOrder];
    const fromIdx = newOrder.indexOf(draggedItem);
    const toIdx = newOrder.indexOf(targetId);
    newOrder.splice(fromIdx, 1);
    newOrder.splice(toIdx, 0, draggedItem);
    setColumnOrder(newOrder);
    // Always keep select first, actions last when applying to table
    const full = ["select", ...newOrder.filter((id) => id !== "select" && id !== "actions"), "actions"];
    table.setColumnOrder(full);
    if (lsKey) localStorage.setItem(lsKey, JSON.stringify(newOrder));
  };

  const handleDragEnd = () => {
    setDraggedItem(null);
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger>
        <Button variant="outline" size="sm" className="ml-auto hidden h-8 lg:flex">
          <Settings2 className="mr-2 h-4 w-4" />
          Columns
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-[200px]">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Toggle & reorder</DropdownMenuLabel>
        </DropdownMenuGroup>
        <div className="space-y-0.5 p-1">
          {orderedColumns.map((col) => (
            <div
              key={col.id}
              draggable
              onDragStart={() => handleDragStart(col.id)}
              onDragOver={(e) => handleDragOver(e, col.id)}
              onDragEnd={handleDragEnd}
              className={`flex items-center gap-2 rounded px-2 py-1.5 text-sm cursor-grab active:cursor-grabbing hover:bg-accent ${draggedItem === col.id ? "opacity-50" : ""}`}
            >
              <GripVertical className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              <Checkbox
                checked={col.getIsVisible()}
                onCheckedChange={() => col.toggleVisibility(!col.getIsVisible())}
              />
              <span className="truncate">{getColumnLabel(col)}</span>
            </div>
          ))}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
