"use client";

import { type Column } from "@tanstack/react-table";
import { ArrowDown, ArrowUp, ChevronsUpDown, GripVertical } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

interface DataTableColumnHeaderProps<TData, TValue> extends React.HTMLAttributes<HTMLDivElement> {
  column: Column<TData, TValue>;
  title: string;
}

export function DataTableColumnHeader<TData, TValue>({
  column,
  title,
  className,
}: DataTableColumnHeaderProps<TData, TValue>) {
  if (!column.getCanSort()) {
    return (
      <div className={cn("flex items-center gap-1", className)}>
        <GripVertical className="h-3.5 w-3.5 text-muted-foreground/50 shrink-0" />
        <span>{title}</span>
      </div>
    );
  }

  return (
    <div className={cn("flex items-center gap-0.5", className)}>
      <GripVertical className="h-3.5 w-3.5 text-muted-foreground/50 shrink-0" />
      <Button
        variant="ghost"
        size="sm"
        className="-ml-1 h-8 data-[state=open]:bg-accent"
        onClick={(e) => { e.stopPropagation(); column.toggleSorting(column.getIsSorted() === "asc"); }}
      >
        <span>{title}</span>
        {column.getIsSorted() === "desc" ? (
          <ArrowDown className="ml-2 h-4 w-4" />
        ) : column.getIsSorted() === "asc" ? (
          <ArrowUp className="ml-2 h-4 w-4" />
        ) : (
          <ChevronsUpDown className="ml-2 h-4 w-4" />
        )}
      </Button>
    </div>
  );
}
