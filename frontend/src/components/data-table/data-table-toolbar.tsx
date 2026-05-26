"use client";

import { type Table } from "@tanstack/react-table";
import { Download, Trash2, Upload, X } from "lucide-react";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { DataTableViewOptions } from "./data-table-view-options";
import { DataTableFacetedFilter } from "./data-table-faceted-filter";

interface DataTableToolbarProps<TData> {
  table: Table<TData>;
  searchKey?: string;
  searchPlaceholder?: string;
  filterableColumns?: { id: string; title: string; options: { label: string; value: string }[] }[];
  onExport?: () => void;
  onImport?: (file: File) => void;
  onDownloadTemplate?: () => void;
  onBulkDelete?: () => void;
  selectedCount?: number;
  onClearSelection?: () => void;
}

export function DataTableToolbar<TData>({
  table,
  searchKey,
  searchPlaceholder,
  filterableColumns,
  onExport,
  onImport,
  onDownloadTemplate,
  onBulkDelete,
  selectedCount = 0,
  onClearSelection,
}: DataTableToolbarProps<TData>) {
  const isFiltered = table.getState().columnFilters.length > 0;
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);

  return (
    <div className="space-y-2">
      {/* Bulk action bar */}
      {selectedCount > 0 && (
        <div className="flex items-center gap-2 rounded-md border border-border bg-muted/50 px-3 py-2">
          <span className="text-sm font-medium">{selectedCount} selected</span>
          {onBulkDelete && (
            <Button variant="destructive" size="sm" className="h-7" onClick={() => setDeleteDialogOpen(true)}>
              <Trash2 className="mr-1.5 h-3.5 w-3.5" />
              Delete ({selectedCount})
            </Button>
          )}
          {onExport && (
            <Button variant="outline" size="sm" className="h-7" onClick={onExport}>
              <Download className="mr-1.5 h-3.5 w-3.5" />
              Export ({selectedCount})
            </Button>
          )}
          <button onClick={onClearSelection} className="ml-auto flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
            <X className="h-3.5 w-3.5" />
            Clear
          </button>
        </div>
      )}

      {/* Main toolbar */}
      <div className="flex items-center justify-between">
        <div className="flex flex-1 items-center space-x-2">
          {searchKey && (
            <Input
              placeholder={searchPlaceholder || "Search..."}
              value={(table.getColumn(searchKey)?.getFilterValue() as string) ?? ""}
              onChange={(e) => table.getColumn(searchKey)?.setFilterValue(e.target.value)}
              className="h-8 w-[150px] lg:w-[250px]"
            />
          )}
          {filterableColumns?.map(
            (col) =>
              table.getColumn(col.id) && (
                <DataTableFacetedFilter
                  key={col.id}
                  column={table.getColumn(col.id)}
                  title={col.title}
                  options={col.options}
                />
              )
          )}
          {isFiltered && (
            <Button variant="ghost" onClick={() => table.resetColumnFilters()} className="h-8 px-2 lg:px-3">
              Reset
              <X className="ml-2 h-4 w-4" />
            </Button>
          )}
        </div>
        <div className="flex items-center space-x-2">
          {onImport && (
            <Button variant="outline" size="sm" className="h-8" onClick={() => setImportDialogOpen(true)}>
              <Upload className="mr-2 h-4 w-4" />
              Import
            </Button>
          )}
          {onExport && selectedCount === 0 && (
            <Button variant="outline" size="sm" className="h-8" onClick={onExport}>
              <Download className="mr-2 h-4 w-4" />
              Export
            </Button>
          )}
          <DataTableViewOptions table={table} />
        </div>
      </div>

      {/* Import Dialog */}
      {onImport && (
        <Dialog open={importDialogOpen} onOpenChange={setImportDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Import Data</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Upload a CSV file to import data. Make sure your file matches the required format.
              </p>
              {onDownloadTemplate && (
                <div className="flex items-center gap-3 rounded-md border border-dashed border-border p-3">
                  <Download className="h-4 w-4 text-muted-foreground shrink-0" />
                  <div className="flex-1">
                    <p className="text-sm font-medium">Need a template?</p>
                    <p className="text-xs text-muted-foreground">Download the CSV template with the required columns.</p>
                  </div>
                  <Button variant="outline" size="sm" onClick={onDownloadTemplate}>
                    Download
                  </Button>
                </div>
              )}
              <div className="space-y-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) {
                      onImport(file);
                      setImportDialogOpen(false);
                    }
                    e.target.value = "";
                  }}
                />
                <Button className="w-full" onClick={() => fileInputRef.current?.click()}>
                  <Upload className="mr-2 h-4 w-4" />
                  Select CSV File
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}

      {/* Delete Confirmation Dialog */}
      {onBulkDelete && (
        <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Confirm Deletion</DialogTitle>
            </DialogHeader>
            <p className="text-sm text-muted-foreground">
              Are you sure you want to delete {selectedCount} selected item{selectedCount > 1 ? "s" : ""}? This action cannot be undone.
            </p>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDeleteDialogOpen(false)}>Cancel</Button>
              <Button variant="destructive" onClick={() => { onBulkDelete(); setDeleteDialogOpen(false); }}>
                Delete
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
