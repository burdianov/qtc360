"use client";

import {
  type ColumnDef,
  type ColumnFiltersState,
  type SortingState,
  type VisibilityState,
  type RowSelectionState,
  type PaginationState,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { useState, useRef, useCallback, useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import api from "@/lib/api";
import { Check, X } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DataTablePagination } from "./data-table-pagination";
import { DataTableToolbar } from "./data-table-toolbar";

export interface EditableColumn {
  type: "text" | "number" | "select";
  options?: { label: string; value: string }[];
}

interface DataTableProps<TData, TValue> {
  columns: ColumnDef<TData, TValue>[];
  data: TData[];
  searchKey?: string;
  searchPlaceholder?: string;
  filterableColumns?: { id: string; title: string; options: { label: string; value: string }[] }[];
  onExport?: (data: TData[]) => void;
  onImport?: (file: File) => void;
  onDownloadTemplate?: () => void;
  onBulkDelete?: (rows: TData[]) => void;
  onRowClick?: (row: TData) => void;
  // Inline editing
  editableColumns?: Record<string, EditableColumn>;
  onRowUpdate?: (row: TData, updates: Record<string, any>) => Promise<void> | void;
  // Server-side pagination
  serverPagination?: {
    total: number;
    pageIndex: number;
    pageSize: number;
    onPageChange: (pageIndex: number) => void;
    onPageSizeChange: (pageSize: number) => void;
  };
}

export function DataTable<TData, TValue>({
  columns,
  data,
  searchKey,
  searchPlaceholder,
  filterableColumns,
  onExport,
  onImport,
  onDownloadTemplate,
  onBulkDelete,
  onRowClick,
  editableColumns,
  onRowUpdate,
  serverPagination,
}: DataTableProps<TData, TValue>) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({});
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const [editingCell, setEditingCell] = useState<{ rowId: string; colId: string } | null>(null);
  const [editValue, setEditValue] = useState<any>("");
  const [saving, setSaving] = useState(false);

  const startEditingCell = useCallback((rowId: string, colId: string, currentValue: any) => {
    if (!editableColumns?.[colId] || !onRowUpdate) return;
    setEditingCell({ rowId, colId });
    setEditValue(currentValue ?? "");
  }, [editableColumns, onRowUpdate]);

  const cancelEditing = useCallback(() => {
    setEditingCell(null);
    setEditValue("");
  }, []);

  const saveCell = useCallback(async (rowOriginal: TData) => {
    if (!onRowUpdate || !editingCell) return;
    setSaving(true);
    try {
      await onRowUpdate(rowOriginal, { [editingCell.colId]: editValue });
      setEditingCell(null);
      setEditValue("");
    } finally {
      setSaving(false);
    }
  }, [onRowUpdate, editingCell, editValue]);

  // Keyboard handler for inline editing
  useEffect(() => {
    if (!editingCell) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") cancelEditing();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [editingCell, cancelEditing]);

  const selectColumn: ColumnDef<TData, TValue> = {
    id: "select",
    header: ({ table: t }) => (
      <Checkbox
        checked={t.getIsAllPageRowsSelected()}
        onCheckedChange={(value) => t.toggleAllPageRowsSelected(!!value)}
        disabled={t.getRowModel().rows.length === 0}
        aria-label="Select all"
      />
    ),
    cell: ({ row }) => (
      <Checkbox
        checked={row.getIsSelected()}
        onCheckedChange={(value) => row.toggleSelected(!!value)}
        aria-label="Select row"
      />
    ),
    enableSorting: false,
    enableHiding: false,
  };

  const allColumns = [selectColumn, ...columns];

  const table = useReactTable({
    data,
    columns: allColumns,
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    onColumnVisibilityChange: setColumnVisibility,
    onRowSelectionChange: setRowSelection,
    state: { sorting, columnFilters, columnVisibility, rowSelection, ...(serverPagination ? { pagination: { pageIndex: serverPagination.pageIndex, pageSize: serverPagination.pageSize } } : {}) },
    ...(serverPagination ? { manualPagination: true, pageCount: Math.ceil(serverPagination.total / serverPagination.pageSize), onPaginationChange: (updater) => { const next = typeof updater === "function" ? updater({ pageIndex: serverPagination.pageIndex, pageSize: serverPagination.pageSize }) : updater; if (next.pageSize !== serverPagination.pageSize) serverPagination.onPageSizeChange(next.pageSize); if (next.pageIndex !== serverPagination.pageIndex) serverPagination.onPageChange(next.pageIndex); } } : {}),
    meta: { editingCell, editValue, setEditValue, startEditingCell, cancelEditing, saveCell, editableColumns },
  });

  const prefKey = typeof window !== "undefined" ? window.location.pathname.replace(/\//g, "_") : "";

  const { data: preferences } = useQuery<Record<string, any>>({
    queryKey: ["user-preferences"],
    queryFn: async () => (await api.get("/auth/me/preferences")).data,
    staleTime: 60000,
  });

  const queryClient = useQueryClient();
  const saveMutation = useMutation({
    mutationFn: async (order: string[]) => {
      await api.put(`/auth/me/preferences/col_order${prefKey}`, { order });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["user-preferences"] }),
  });

  // Apply saved column order and visibility from DB
  const savedOrder = preferences?.[`col_order${prefKey}`]?.order;
  const savedVisibility = preferences?.[`col_vis${prefKey}`];
  const [orderApplied, setOrderApplied] = useState(false);
  if (preferences && !orderApplied) {
    if (savedOrder && Array.isArray(savedOrder)) {
      const validIds = allColumns.map((c) => (c as any).id || (c as any).accessorKey).filter(Boolean);
      const known = savedOrder.filter((id: string) => validIds.includes(id));
      const newCols = validIds.filter((id: string) => !savedOrder.includes(id));
      const full = ["select", ...known.filter((id: string) => id !== "select" && id !== "actions"), ...newCols.filter((id: string) => id !== "select" && id !== "actions"), "actions"];
      table.setColumnOrder(full);
    }
    if (savedVisibility) setColumnVisibility(savedVisibility);
    setOrderApplied(true);
  }

  const dragCol = useRef<string | null>(null);
  const [dragOverCol, setDragOverCol] = useState<string | null>(null);

  const handleHeaderDragStart = (e: React.DragEvent, colId: string) => {
    dragCol.current = colId;
    e.dataTransfer.effectAllowed = "move";
  };

  const handleHeaderDragOver = (e: React.DragEvent, colId: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragOverCol(colId);
    if (!dragCol.current || dragCol.current === colId || colId === "actions") return;
    const currentOrder = table.getState().columnOrder.length > 0
      ? [...table.getState().columnOrder]
      : allColumns.map((c) => (c as any).id || (c as any).accessorKey).filter(Boolean);
    const fromIdx = currentOrder.indexOf(dragCol.current);
    const toIdx = currentOrder.indexOf(colId);
    if (fromIdx === -1 || toIdx === -1) return;
    currentOrder.splice(fromIdx, 1);
    currentOrder.splice(toIdx, 0, dragCol.current);
    // Ensure actions is always last
    const actionsIdx = currentOrder.indexOf("actions");
    if (actionsIdx !== -1 && actionsIdx !== currentOrder.length - 1) {
      currentOrder.splice(actionsIdx, 1);
      currentOrder.push("actions");
    }
    table.setColumnOrder(currentOrder);
  };

  const handleHeaderDragEnd = () => {
    dragCol.current = null;
    setDragOverCol(null);
    const order = table.getState().columnOrder.filter((id) => id !== "select" && id !== "actions");
    saveMutation.mutate(order);
  };

  const renderEditableCell = (colId: string, row: any) => {
    if (!editableColumns?.[colId]) return null;
    const config = editableColumns[colId];

    if (config.type === "select" && config.options) {
      const selectedLabel = config.options.find((o) => o.value === editValue)?.label || "";
      return (
        <div className="flex items-center gap-1">
          <Select value={editValue} onValueChange={(v) => { setEditValue(v); }}>
            <SelectTrigger className="h-8 text-xs flex-1">
              <SelectValue>{selectedLabel}</SelectValue>
            </SelectTrigger>
            <SelectContent className="max-h-[320px]">
              {config.options.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <button onClick={(e) => { e.stopPropagation(); saveCell(row.original); }} disabled={saving} className="inline-flex items-center justify-center h-7 w-7 rounded hover:bg-green-100 text-green-600 dark:hover:bg-green-900/30" title="Save"><Check className="h-3.5 w-3.5" /></button>
          <button onClick={(e) => { e.stopPropagation(); cancelEditing(); }} className="inline-flex items-center justify-center h-7 w-7 rounded hover:bg-red-100 text-red-600 dark:hover:bg-red-900/30" title="Cancel"><X className="h-3.5 w-3.5" /></button>
        </div>
      );
    }

    return (
      <div className="flex items-center gap-1">
        <Input
          className="h-8 text-xs flex-1"
          type={config.type === "number" ? "number" : "text"}
          value={editValue}
          onChange={(e) => setEditValue(config.type === "number" ? Number(e.target.value) : e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") saveCell(row.original); }}
          autoFocus
        />
        <button onClick={(e) => { e.stopPropagation(); saveCell(row.original); }} disabled={saving} className="inline-flex items-center justify-center h-7 w-7 rounded hover:bg-green-100 text-green-600 dark:hover:bg-green-900/30" title="Save"><Check className="h-3.5 w-3.5" /></button>
        <button onClick={(e) => { e.stopPropagation(); cancelEditing(); }} className="inline-flex items-center justify-center h-7 w-7 rounded hover:bg-red-100 text-red-600 dark:hover:bg-red-900/30" title="Cancel"><X className="h-3.5 w-3.5" /></button>
      </div>
    );
  };

  return (
    <div className="space-y-4">
      <DataTableToolbar
        table={table}
        searchKey={searchKey}
        searchPlaceholder={searchPlaceholder}
        filterableColumns={filterableColumns}
        onExport={onExport ? () => {
          const selected = table.getFilteredSelectedRowModel().rows;
          onExport(selected.length > 0 ? selected.map((r) => r.original) : data);
        } : undefined}
        onImport={onImport}
        onDownloadTemplate={onDownloadTemplate}
        onBulkDelete={onBulkDelete ? () => {
          const selected = table.getFilteredSelectedRowModel().rows.map((r) => r.original);
          if (selected.length > 0) {
            onBulkDelete(selected);
            table.resetRowSelection();
          }
        } : undefined}
        selectedCount={table.getFilteredSelectedRowModel().rows.length}
        onClearSelection={() => table.resetRowSelection()}
      />
      <div className="rounded-md border overflow-x-auto">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => {
                  const isDraggable = header.column.id !== "select" && header.column.id !== "actions";
                  const isOver = dragOverCol === header.column.id && dragCol.current !== header.column.id;
                  const meta = header.column.columnDef.meta as { width?: string } | undefined;
                  return (
                    <TableHead
                      key={header.id}
                      draggable={isDraggable}
                      onDragStart={(e) => isDraggable && handleHeaderDragStart(e, header.column.id)}
                      onDragOver={(e) => isDraggable && handleHeaderDragOver(e, header.column.id)}
                      onDragEnd={isDraggable ? handleHeaderDragEnd : undefined}
                      onDragLeave={() => setDragOverCol(null)}
                      className={`${isDraggable ? "cursor-grab active:cursor-grabbing select-none" : ""} ${isOver ? "border-l-2 border-l-primary" : ""} transition-colors`}
                      style={meta?.width ? { width: meta.width, minWidth: meta.width } : undefined}
                    >
                      {header.isPlaceholder
                        ? null
                        : flexRender(header.column.columnDef.header, header.getContext())}
                    </TableHead>
                  );
                })}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows?.length ? (
              table.getRowModel().rows.map((row) => {
                const rowId = (row.original as any).id;
                return (
                  <TableRow
                    key={row.id}
                    data-state={row.getIsSelected() && "selected"}
                    className={onRowClick ? "cursor-pointer" : ""}
                    onClick={() => onRowClick?.(row.original)}
                  >
                    {row.getVisibleCells().map((cell) => {
                      const colId = (cell.column.columnDef as any).accessorKey || cell.column.id;
                      const isThisCellEditing = editingCell?.rowId === rowId && editingCell?.colId === colId;
                      const isEditable = editableColumns?.[colId] && onRowUpdate;

                      if (isThisCellEditing) {
                        return (
                          <TableCell key={cell.id} onClick={(e) => e.stopPropagation()}>
                            {renderEditableCell(colId, row)}
                          </TableCell>
                        );
                      }

                      return (
                        <TableCell
                          key={cell.id}
                          className={isEditable ? "cursor-pointer hover:bg-muted/50" : ""}
                          onClick={(e) => {
                            if (isEditable) {
                              e.stopPropagation();
                              const currentVal = (cell.column.columnDef as any).accessorKey
                                ? (row.original as any)[colId]
                                : cell.getValue();
                              startEditingCell(rowId, colId, currentVal);
                            }
                          }}
                        >
                          {flexRender(cell.column.columnDef.cell, cell.getContext())}
                        </TableCell>
                      );
                    })}
                  </TableRow>
                );
              })
            ) : (
              <TableRow>
                <TableCell colSpan={allColumns.length} className="h-24 text-center">
                  No results.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
      <DataTablePagination table={table} />
    </div>
  );
}
