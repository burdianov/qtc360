"use client";

import {
  type ColumnDef,
  type ColumnFiltersState,
  type SortingState,
  type VisibilityState,
  type RowSelectionState,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { useState, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import api from "@/lib/api";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { DataTablePagination } from "./data-table-pagination";
import { DataTableToolbar } from "./data-table-toolbar";

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
}: DataTableProps<TData, TValue>) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({});
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});

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
    state: { sorting, columnFilters, columnVisibility, rowSelection },
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

  // Apply saved column order from DB
  const savedOrder = preferences?.[`col_order${prefKey}`]?.order;
  const [orderApplied, setOrderApplied] = useState(false);
  if (savedOrder && Array.isArray(savedOrder) && !orderApplied) {
    const validIds = allColumns.map((c) => (c as any).id || (c as any).accessorKey).filter(Boolean);
    const known = savedOrder.filter((id: string) => validIds.includes(id));
    const newCols = validIds.filter((id: string) => !savedOrder.includes(id));
    const full = ["select", ...known.filter((id: string) => id !== "select" && id !== "actions"), ...newCols.filter((id: string) => id !== "select" && id !== "actions"), "actions"];
    table.setColumnOrder(full);
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
    if (!dragCol.current || dragCol.current === colId) return;
    const currentOrder = table.getState().columnOrder.length > 0
      ? [...table.getState().columnOrder]
      : allColumns.map((c) => (c as any).id || (c as any).accessorKey).filter(Boolean);
    const fromIdx = currentOrder.indexOf(dragCol.current);
    const toIdx = currentOrder.indexOf(colId);
    if (fromIdx === -1 || toIdx === -1) return;
    currentOrder.splice(fromIdx, 1);
    currentOrder.splice(toIdx, 0, dragCol.current);
    table.setColumnOrder(currentOrder);
  };

  const handleHeaderDragEnd = () => {
    dragCol.current = null;
    setDragOverCol(null);
    const order = table.getState().columnOrder.filter((id) => id !== "select" && id !== "actions");
    saveMutation.mutate(order);
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
                  return (
                    <TableHead
                      key={header.id}
                      draggable={isDraggable}
                      onDragStart={(e) => isDraggable && handleHeaderDragStart(e, header.column.id)}
                      onDragOver={(e) => isDraggable && handleHeaderDragOver(e, header.column.id)}
                      onDragEnd={isDraggable ? handleHeaderDragEnd : undefined}
                      onDragLeave={() => setDragOverCol(null)}
                      className={`${isDraggable ? "cursor-grab active:cursor-grabbing select-none" : ""} ${isOver ? "border-l-2 border-l-primary" : ""} transition-colors`}
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
              table.getRowModel().rows.map((row) => (
                <TableRow key={row.id} data-state={row.getIsSelected() && "selected"} className={onRowClick ? "cursor-pointer" : ""} onClick={() => onRowClick?.(row.original)}>
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id}>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  ))}
                </TableRow>
              ))
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
