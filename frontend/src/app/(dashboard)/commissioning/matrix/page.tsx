"use client";

import { useMemo, useState, useRef, useCallback, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ChevronRight, ChevronDown, Search, X, FileText, Download } from "lucide-react";

import api from "@/lib/api";
import { useSelectedProject } from "@/hooks/use-project";
import { useSidebar } from "@/components/ui/sidebar";
import { levelColors } from "@/lib/constants";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

// ─── Types ───────────────────────────────────────────────────────────────────

interface Column {
  id: string;
  name: string;
  code: string;
  level_code: string;
  doc_type: string;
  sort_order: number;
}

interface DocRef {
  id: string;
  reference_no: string;
  status: string;
}

interface CellData {
  status: string;
  progress: number;
  docs: DocRef[];
}

interface Blocker {
  template_name: string;
  level_code: string;
  status: string;
}

interface Row {
  asset_id: string;
  asset_name: string;
  tag_number: string;
  asset_type: string | null;
  pod: string;
  location: string | null;
  progress: number;
  achieved_count: number;
  total_count: number;
  blocker: Blocker | null;
  achieved_levels: string[];
  cells: Record<string, CellData>;
}

interface MatrixData {
  columns: Column[];
  rows: Row[];
}

interface SelectedCell {
  row: Row;
  column: Column;
  cell: CellData;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const DEFAULT_FROZEN_COLS = { type: 130, pod: 60, tag: 130, progress: 100 };
const COL_WIDTH = 88;
const ROW_HEIGHT = 40;
const HEADER_HEIGHT = 88;
const LEVEL_ORDER = ["L1", "L2A", "L2B", "L3", "L4", "L5"];

const STATUS_COLORS: Record<string, string> = {
  achieved: "bg-emerald-500",
  submitted: "bg-amber-400",
  partial: "bg-amber-400",
  rejected: "bg-red-500",
  not_applicable: "bg-zinc-300 dark:bg-zinc-600",
  not_started: "bg-zinc-100 dark:bg-zinc-800",
};

const STATUS_LABELS: Record<string, string> = {
  achieved: "Achieved",
  submitted: "Submitted",
  partial: "In Progress",
  rejected: "Rejected",
  not_applicable: "N/A",
  not_started: "Not Started",
};

// ─── Page ────────────────────────────────────────────────────────────────────

export default function MatrixPage() {
  const project = useSelectedProject();
  const { setOpen: setSidebarOpen } = useSidebar();
  const [search, setSearch] = useState("");
  const [collapsedLevels, setCollapsedLevels] = useState<Set<string>>(
    new Set(LEVEL_ORDER),
  );
  const [quickFilter, setQuickFilter] = useState<string | null>(null);
  const [selectedCell, setSelectedCell] = useState<SelectedCell | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const matrixBodyRef = useRef<HTMLDivElement>(null);

  // Resizable frozen columns
  const [colWidths, setColWidths] = useState(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("matrix-col-widths");
      if (saved) try { return { ...DEFAULT_FROZEN_COLS, ...JSON.parse(saved) }; } catch {}
    }
    return DEFAULT_FROZEN_COLS;
  });
  const frozenWidth = colWidths.type + colWidths.pod + colWidths.tag + colWidths.progress;

  const onResizeStart = useCallback((key: keyof typeof DEFAULT_FROZEN_COLS, startX: number) => {
    const startWidth = colWidths[key];
    const onMove = (e: MouseEvent) => {
      const delta = e.clientX - startX;
      setColWidths((prev: typeof DEFAULT_FROZEN_COLS) => {
        const next = { ...prev, [key]: Math.max(40, startWidth + delta) };
        localStorage.setItem("matrix-col-widths", JSON.stringify(next));
        return next;
      });
    };
    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }, [colWidths]);

  // Collapse sidebar on this page for maximum matrix width (once on mount)
  useEffect(() => { setSidebarOpen(false); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const { data, isLoading } = useQuery<MatrixData>({
    queryKey: ["commissioning-matrix", project?.id],
    queryFn: async () =>
      (await api.get("/commissioning/matrix", { params: { project_id: project!.id } })).data,
    enabled: !!project?.id,
  });

  const columns = data?.columns ?? [];
  const rows = data?.rows ?? [];

  // Group columns by level
  const levelGroups = useMemo(() => {
    const groups: Record<string, Column[]> = {};
    for (const col of columns) {
      (groups[col.level_code] ??= []).push(col);
    }
    return groups;
  }, [columns]);

  // Visible columns based on expanded levels
  const visibleColumns = useMemo(() => {
    const result: Column[] = [];
    for (const level of LEVEL_ORDER) {
      if (!levelGroups[level]) continue;
      if (!collapsedLevels.has(level)) {
        result.push(...levelGroups[level]);
      }
    }
    return result;
  }, [levelGroups, collapsedLevels]);

  // Filter rows
  const filteredRows = useMemo(() => {
    let result = rows;
    if (search) {
      const q = search.toLowerCase();
      result = result.filter(
        (r) =>
          r.tag_number?.toLowerCase().includes(q) ||
          r.asset_name?.toLowerCase().includes(q) ||
          r.pod?.toLowerCase().includes(q) ||
          r.asset_type?.toLowerCase().includes(q),
      );
    }
    if (quickFilter === "incomplete") {
      result = result.filter((r) => r.progress < 1);
    } else if (quickFilter === "complete") {
      result = result.filter((r) => r.progress >= 1);
    } else if (quickFilter === "blocked") {
      result = result.filter((r) => r.blocker !== null);
    }
    return result;
  }, [rows, search, quickFilter]);

  // Virtualizer for rows
  const rowVirtualizer = useVirtualizer({
    count: filteredRows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 10,
  });

  const toggleLevel = useCallback((level: string) => {
    setCollapsedLevels((prev) => {
      const next = new Set(prev);
      if (next.has(level)) next.delete(level);
      else next.add(level);
      return next;
    });
  }, []);

  // Total scrollable width for requirement columns
  const totalRequirementWidth = useMemo(() => {
    let width = 0;
    for (const level of LEVEL_ORDER) {
      if (!levelGroups[level]) continue;
      if (collapsedLevels.has(level)) {
        width += COL_WIDTH; // collapsed summary column
      } else {
        width += levelGroups[level].length * COL_WIDTH;
      }
    }
    return width;
  }, [levelGroups, collapsedLevels]);

  if (!project) {
    return <div className="p-6 text-muted-foreground">Select a project to view the matrix.</div>;
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-pulse text-muted-foreground">Loading matrix…</div>
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="p-6 space-y-4">
        <h1 className="text-lg font-semibold">Requirements Achievement Matrix</h1>
        <div className="text-center py-16 text-muted-foreground">
          <p className="text-lg">No assets with requirements found.</p>
          <p className="text-sm mt-1">Assign requirement templates to assets to populate the matrix.</p>
        </div>
      </div>
    );
  }

  return (
    <TooltipProvider delay={200}>
      <div className="flex flex-col h-[calc(100vh-5rem)] -mb-6">
        {/* Toolbar */}
        <div className="flex items-center gap-3 px-4 py-2 border-b shrink-0">
          <h1 className="text-base font-semibold whitespace-nowrap">Matrix</h1>
          <div className="relative flex-1 max-w-xs">
            <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search assets…"
              className="h-8 pl-8 text-sm"
            />
            {search && (
              <button onClick={() => setSearch("")} className="absolute right-2 top-2 text-muted-foreground hover:text-foreground">
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          <div className="flex gap-1.5">
            {[
              { key: "incomplete", label: "Incomplete" },
              { key: "complete", label: "Complete" },
              { key: "blocked", label: "Blocked" },
            ].map((f) => (
              <button
                key={f.key}
                onClick={() => setQuickFilter((prev) => (prev === f.key ? null : f.key))}
                className={`px-2.5 py-1 rounded text-xs font-medium border transition-colors ${
                  quickFilter === f.key
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-background border-input hover:bg-accent"
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
          <span className="text-xs text-muted-foreground ml-auto">
            {filteredRows.length} / {rows.length} assets
          </span>
          <Button
            variant="outline"
            size="sm"
            className="h-8 text-xs"
            onClick={() => {
              const csv = exportMatrixCsv(columns, filteredRows, levelGroups);
              const blob = new Blob([csv], { type: "text/csv" });
              const url = URL.createObjectURL(blob);
              const a = document.createElement("a");
              a.href = url;
              a.download = "matrix-export.csv";
              a.click();
              URL.revokeObjectURL(url);
            }}
          >
            <Download className="h-3.5 w-3.5 mr-1" />
            Export
          </Button>
        </div>

        {/* Matrix container */}
        <div className="flex-1 overflow-hidden relative">
          {/* Frozen columns */}
          <div
            className="absolute top-0 left-0 z-20 bg-background border-r"
            style={{ width: frozenWidth, height: "100%" }}
          >
            {/* Frozen header */}
            <div
              className="flex items-end border-b bg-muted/30 text-xs font-medium text-muted-foreground"
              style={{ height: HEADER_HEIGHT }}
            >
              {([["type", "Type"], ["pod", "POD"], ["tag", "Tag Number"], ["progress", "Progress"]] as const).map(([key, label]) => (
                <div key={key} className="relative flex items-center justify-center select-none" style={{ width: colWidths[key], height: "100%" }}>
                  <span className="truncate text-center">{label}</span>
                  <div
                    className="absolute right-0 top-0 bottom-0 w-[5px] cursor-col-resize z-10 group"
                    onMouseDown={(e) => { e.preventDefault(); onResizeStart(key, e.clientX); }}
                  >
                    <div className="absolute inset-y-0 right-[2px] w-[1px] bg-border group-hover:bg-primary group-active:bg-primary" />
                  </div>
                </div>
              ))}
            </div>
            {/* Frozen rows */}
            <div
              ref={scrollRef}
              className="overflow-auto"
              style={{ height: `calc(100% - ${HEADER_HEIGHT}px)` }}
              onScroll={(e) => {
                if (matrixBodyRef.current && matrixBodyRef.current.scrollTop !== e.currentTarget.scrollTop) {
                  matrixBodyRef.current.scrollTop = e.currentTarget.scrollTop;
                }
              }}
            >
              <div style={{ height: rowVirtualizer.getTotalSize(), position: "relative" }}>
                {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                  const row = filteredRows[virtualRow.index];
                  return (
                    <div
                      key={row.asset_id}
                      className="absolute left-0 w-full flex items-center border-b text-xs hover:bg-accent/30"
                      style={{ top: virtualRow.start, height: ROW_HEIGHT }}
                    >
                      <div className="px-2 truncate" style={{ width: colWidths.type }} title={row.asset_type || ""}>
                        {row.asset_type || "—"}
                      </div>
                      <div className="px-2 truncate" style={{ width: colWidths.pod }} title={row.pod}>
                        {row.pod || "—"}
                      </div>
                      <div className="px-2 truncate font-medium" style={{ width: colWidths.tag }} title={row.tag_number}>
                        {row.tag_number}
                      </div>
                      <div className="px-2 flex items-center gap-1.5" style={{ width: colWidths.progress }}>
                        <Progress value={row.progress * 100} className="h-1.5 flex-1" />
                        <span className="text-[10px] text-muted-foreground whitespace-nowrap">
                          {row.achieved_count}/{row.total_count}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Scrollable requirement columns */}
          <div
            className="absolute top-0 bottom-0 overflow-x-auto overflow-y-hidden"
            style={{ left: frozenWidth, right: 0 }}
          >
            <div style={{ width: totalRequirementWidth }}>
              {/* Vertical scroll container */}
              <div
                ref={matrixBodyRef}
                className="overflow-y-auto overflow-x-hidden"
                style={{ height: "100vh", maxHeight: "calc(100vh - 5rem)" }}
                onScroll={(e) => {
                  if (scrollRef.current && scrollRef.current.scrollTop !== e.currentTarget.scrollTop) {
                    scrollRef.current.scrollTop = e.currentTarget.scrollTop;
                  }
                }}
              >
              {/* Level headers */}
              <div className="flex border-b bg-muted/30 sticky top-0 z-10" style={{ height: HEADER_HEIGHT }}>
                {LEVEL_ORDER.map((level) => {
                  const cols = levelGroups[level];
                  if (!cols) return null;
                  const collapsed = collapsedLevels.has(level);
                  const width = collapsed ? COL_WIDTH : cols.length * COL_WIDTH;

                  return (
                    <div key={level} style={{ width }} className={`border-r last:border-r-0 flex flex-col overflow-hidden ${levelColors[level] || ""}`}>
                      <button
                        onClick={() => toggleLevel(level)}
                        className="flex items-center justify-center gap-1 px-2 py-1 text-xs font-semibold hover:bg-accent/50 transition-colors border-b"
                      >
                        {collapsed ? <ChevronRight className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                        {level}
                        <span className="text-[10px] font-normal text-muted-foreground ml-1">
                          ({cols.length})
                        </span>
                      </button>
                      {!collapsed && (
                        <div className="flex flex-1">
                          {cols.map((col) => (
                            <div
                              key={col.id}
                              className="flex-1 px-1 py-0.5 text-[10px] text-muted-foreground dark:text-zinc-400 border-r last:border-r-0 flex items-center justify-center text-center leading-tight"
                              style={{ width: COL_WIDTH, minWidth: COL_WIDTH, maxWidth: COL_WIDTH }}
                              title={col.name}
                            >
                              <span className="line-clamp-3">{col.name}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Matrix body */}
              <div style={{ height: rowVirtualizer.getTotalSize(), position: "relative" }}>
                  {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                    const row = filteredRows[virtualRow.index];
                    return (
                      <div
                        key={row.asset_id}
                        className="absolute left-0 flex items-center border-b"
                        style={{ top: virtualRow.start, height: ROW_HEIGHT, width: totalRequirementWidth }}
                      >
                        {LEVEL_ORDER.map((level) => {
                          const cols = levelGroups[level];
                          if (!cols) return null;
                          const collapsed = collapsedLevels.has(level);
                          const width = collapsed ? COL_WIDTH : cols.length * COL_WIDTH;

                          const levelCells = cols.map((c) => row.cells[c.id]).filter(Boolean);
                          const levelAchieved = levelCells.filter((c) => c.status === "achieved").length;
                          const levelTotal = levelCells.length;
                          const pct = levelTotal > 0 ? Math.round((levelAchieved / levelTotal) * 100) : 0;
                          const allDone = pct === 100;

                          return (
                            <div
                              key={level}
                              className="flex border-r overflow-hidden"
                              style={{ width, height: ROW_HEIGHT }}
                            >
                              {collapsed ? (
                                <div
                                  className={`flex items-center justify-center text-[10px] font-medium w-full ${
                                    allDone ? "bg-emerald-500/10 text-emerald-600" : "text-muted-foreground"
                                  }`}
                                >
                                  {levelTotal > 0 ? `${pct}%` : "—"}
                                </div>
                              ) : (
                                cols.map((col) => {
                                  const cell = row.cells[col.id];
                                  return (
                                    <MatrixCell
                                      key={col.id}
                                      cell={cell}
                                      colName={col.name}
                                      tagNumber={row.tag_number}
                                      onClick={cell ? () => setSelectedCell({ row, column: col, cell }) : undefined}
                                    />
                                  );
                                })
                              )}
                            </div>
                          );
                        })}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
      {/* Requirement details drawer */}
      <RequirementDrawer
        selected={selectedCell}
        onClose={() => setSelectedCell(null)}
      />
    </TooltipProvider>
  );
}

// ─── Cell Component ──────────────────────────────────────────────────────────

function MatrixCell({
  cell,
  colName,
  tagNumber,
  onClick,
}: {
  cell: CellData | undefined;
  colName: string;
  tagNumber: string;
  onClick?: () => void;
}) {
  if (!cell) {
    return <div className="border-r" style={{ width: COL_WIDTH, height: ROW_HEIGHT }} />;
  }

  const statusColor = STATUS_COLORS[cell.status] || STATUS_COLORS.not_started;
  const docRef = cell.docs?.[0]?.reference_no;

  return (
    <Tooltip>
      <TooltipTrigger
        render={(triggerProps) => (
          <div
            {...triggerProps}
            onClick={onClick}
            className="flex items-center justify-center border-r cursor-pointer hover:ring-1 hover:ring-primary/40 hover:z-10 transition-shadow"
            style={{ width: COL_WIDTH, height: ROW_HEIGHT }}
          >
            <div className="flex flex-col items-center gap-0.5">
              <div className={`h-2.5 w-2.5 rounded-full ${statusColor}`} />
              {docRef && (
                <span className="text-[9px] text-muted-foreground truncate max-w-[76px]">
                  {docRef.replace(/^MERC-JMJV-\w+-/, "")}
                </span>
              )}
            </div>
          </div>
        )}
      />
      <TooltipContent side="top" className="!block w-max max-w-[min(640px,90vw)] p-3 space-y-2 bg-popover text-popover-foreground border shadow-md">
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm font-semibold leading-tight whitespace-nowrap">{colName}</span>
          <span className="text-xs text-muted-foreground whitespace-nowrap">{tagNumber}</span>
        </div>
        <div className="flex items-center gap-2">
          <div className={`h-2.5 w-2.5 rounded-full shrink-0 ${STATUS_COLORS[cell.status]}`} />
          <span className="text-xs font-medium whitespace-nowrap">{STATUS_LABELS[cell.status] || cell.status}</span>
        </div>
        {cell.docs.length > 0 && (
          <div className="border-t pt-2 space-y-1">
            <span className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium">Documents</span>
            {cell.docs.map((d) => (
              <div key={d.id} className="flex items-center justify-between gap-3 text-xs">
                <span className="font-mono whitespace-pre-wrap break-all">{d.reference_no}</span>
                <span className={`shrink-0 capitalize whitespace-nowrap ${d.status === "approved" || d.status === "approved_with_comments" ? "text-emerald-600" : d.status === "rejected" ? "text-red-500" : "text-muted-foreground"}`}>
                  {d.status.replace(/_/g, " ")}
                </span>
              </div>
            ))}
          </div>
        )}
      </TooltipContent>
    </Tooltip>
  );
}



// ─── Requirement Details Drawer ──────────────────────────────────────────────

function RequirementDrawer({
  selected,
  onClose,
}: {
  selected: SelectedCell | null;
  onClose: () => void;
}) {
  if (!selected) {
    return (
      <div className="fixed top-0 right-0 z-50 h-full w-[380px] bg-background border-l shadow-xl flex flex-col transition-transform duration-200 ease-in-out translate-x-full pointer-events-none" />
    );
  }

  const { row, column, cell } = selected;

  return (
    <div className="fixed top-0 right-0 z-50 h-full w-[380px] bg-background border-l shadow-xl flex flex-col transition-transform duration-200 ease-in-out translate-x-0">
      {/* Header */}
      <div className="flex items-center justify-between px-4 pt-3.5 pb-[13px] border-b shrink-0">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold truncate">{column.name}</h2>
          <p className="text-xs text-muted-foreground">{row.tag_number}</p>
        </div>
        <button onClick={onClose} className="p-1 rounded hover:bg-accent">
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-5">
        {/* Status */}
        <div>
          <label className="text-xs text-muted-foreground">Status</label>
          <div className="flex items-center gap-2 mt-1">
            <div className={`h-3 w-3 rounded-full ${STATUS_COLORS[cell.status]}`} />
            <span className="text-sm font-medium">{STATUS_LABELS[cell.status] || cell.status}</span>
          </div>
        </div>

        {/* Requirement info */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-muted-foreground">Level</label>
            <p className="text-sm">{column.level_code}</p>
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Document Type</label>
            <p className="text-sm">{column.doc_type}</p>
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Asset</label>
            <p className="text-sm truncate" title={row.tag_number}>{row.tag_number}</p>
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Progress</label>
            <p className="text-sm">{Math.round(cell.progress)}%</p>
          </div>
        </div>

        <Separator />

        {/* Evidence Documents */}
        <div>
          <label className="text-xs text-muted-foreground mb-2 block">Evidence Documents</label>
          {cell.docs.length === 0 ? (
            <p className="text-sm text-muted-foreground italic">No documents linked.</p>
          ) : (
            <div className="space-y-2">
              {cell.docs.map((doc) => (
                <a
                  key={doc.id}
                  href={`/qaqc/${column.doc_type.toLowerCase()}?doc=${doc.id}`}
                  className="flex items-center gap-2 p-2 rounded-md border hover:bg-accent/50 transition-colors group"
                >
                  <FileText className="h-4 w-4 text-muted-foreground group-hover:text-primary shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate">{doc.reference_no}</p>
                    <p className="text-xs text-muted-foreground capitalize">{doc.status.replace(/_/g, " ")}</p>
                  </div>
                  <Badge
                    variant="outline"
                    className={`text-[10px] shrink-0 ${
                      doc.status === "approved" || doc.status === "approved_with_comments"
                        ? "border-emerald-500/50 text-emerald-600"
                        : doc.status === "rejected"
                          ? "border-red-500/50 text-red-600"
                          : ""
                    }`}
                  >
                    {doc.status === "approved" || doc.status === "approved_with_comments" ? "Approved" : doc.status === "rejected" ? "Rejected" : "Pending"}
                  </Badge>
                </a>
              ))}
            </div>
          )}
        </div>

        <Separator />

        {/* Blocker info if this is the blocking requirement */}
        {row.blocker && row.blocker.template_name === column.name && (
          <div className="rounded-md bg-destructive/5 border border-destructive/20 p-3">
            <p className="text-xs font-medium text-destructive">⚠ This requirement is blocking progress</p>
            <p className="text-xs text-muted-foreground mt-1">
              Complete this requirement to allow the asset to advance.
            </p>
          </div>
        )}

        {/* Asset context */}
        <div>
          <label className="text-xs text-muted-foreground mb-2 block">Asset Details</label>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div>
              <span className="text-muted-foreground">Type:</span>{" "}
              <span>{row.asset_type || "—"}</span>
            </div>
            <div>
              <span className="text-muted-foreground">POD:</span>{" "}
              <span>{row.pod || "—"}</span>
            </div>
            <div className="col-span-2">
              <span className="text-muted-foreground">Overall Progress:</span>{" "}
              <span>{row.achieved_count}/{row.total_count} ({Math.round(row.progress * 100)}%)</span>
            </div>
            <div className="col-span-2">
              <span className="text-muted-foreground">Achieved Tags:</span>{" "}
              <span>{row.achieved_levels.length > 0 ? row.achieved_levels.join(", ") : "None"}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── CSV Export ──────────────────────────────────────────────────────────────

function exportMatrixCsv(
  columns: Column[],
  rows: Row[],
  levelGroups: Record<string, Column[]>,
) {
  const header = ["Asset Type", "POD", "Tag Number", "Progress", "Blocker"];
  for (const level of LEVEL_ORDER) {
    const cols = levelGroups[level];
    if (!cols) continue;
    for (const col of cols) header.push(`[${col.level_code}] ${col.name}`);
  }

  const csvRows = [header.join(",")];
  for (const row of rows) {
    const line: string[] = [
      esc(row.asset_type || ""),
      esc(row.pod || ""),
      esc(row.tag_number),
      `${Math.round(row.progress * 100)}%`,
      esc(row.blocker?.template_name || ""),
    ];
    for (const level of LEVEL_ORDER) {
      const cols = levelGroups[level];
      if (!cols) continue;
      for (const col of cols) {
        const cell = row.cells[col.id];
        if (!cell) { line.push(""); continue; }
        const doc = cell.docs?.[0]?.reference_no || "";
        line.push(esc(`${cell.status}${doc ? " " + doc : ""}`));
      }
    }
    csvRows.push(line.join(","));
  }
  return csvRows.join("\n");
}

function esc(v: string) {
  return v.includes(",") || v.includes('"') ? `"${v.replace(/"/g, '""')}"` : v;
}
