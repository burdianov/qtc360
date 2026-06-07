"use client";

import { useState, useMemo, useCallback, useRef } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import { ZoomIn, ZoomOut, Maximize2, X, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";

if (typeof window !== "undefined") {
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/build/pdf.worker.min.mjs",
    import.meta.url
  ).toString();
}

import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pdfUrl: string | null;
  title?: string;
}

export function PdfPreviewModal({ open, onOpenChange, pdfUrl, title }: Props) {
  const [numPages, setNumPages] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [currentPage, setCurrentPage] = useState(1);
  const [panning, setPanning] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const panRef = useRef<{ x: number; y: number; scrollLeft: number; scrollTop: number } | null>(null);

  const fileObj = useMemo(() => (pdfUrl ? { url: pdfUrl } : null), [pdfUrl]);

  const clampZoom = (z: number) => Math.min(3, Math.max(0.4, Math.round(z * 10) / 10));
  const zoomIn = () => setZoom((z) => clampZoom(z + 0.1));
  const zoomOut = () => setZoom((z) => clampZoom(z - 0.1));
  const resetZoom = () => setZoom(1);

  const goToPage = (page: number) => {
    const el = document.getElementById(`pdf-page-${page}`);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
    setCurrentPage(page);
  };

  // Ctrl+scroll zoom - use native event to preventDefault
  const wheelHandlerRef = useRef<((e: WheelEvent) => void) | null>(null);
  const handleWheelRef = useCallback((container: HTMLDivElement | null) => {
    if (containerRef.current && wheelHandlerRef.current) {
      containerRef.current.removeEventListener("wheel", wheelHandlerRef.current);
      wheelHandlerRef.current = null;
    }
    containerRef.current = container;
    if (!container) return;
    const handler = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      setZoom((z) => clampZoom(z + (e.deltaY < 0 ? 0.1 : -0.1)));
    };
    wheelHandlerRef.current = handler;
    container.addEventListener("wheel", handler, { passive: false });
  }, []);

  // Pan with mouse drag (grab cursor)
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;
    const container = containerRef.current;
    if (!container) return;
    setPanning(true);
    panRef.current = { x: e.clientX, y: e.clientY, scrollLeft: container.scrollLeft, scrollTop: container.scrollTop };
  }, []);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!panning || !panRef.current || !containerRef.current) return;
    const dx = e.clientX - panRef.current.x;
    const dy = e.clientY - panRef.current.y;
    containerRef.current.scrollLeft = panRef.current.scrollLeft - dx;
    containerRef.current.scrollTop = panRef.current.scrollTop - dy;
  }, [panning]);

  const handleMouseUp = useCallback(() => { setPanning(false); panRef.current = null; }, []);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="5xl" showCloseButton={false} className="max-h-[92vh] h-[92vh] flex flex-col p-0 gap-0">
        {/* Toolbar */}
        <div className="flex items-center justify-between px-4 py-2 border-b shrink-0">
          <span className="text-sm font-medium truncate">{title || "PDF Preview"}</span>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={zoomOut} disabled={zoom <= 0.4}>
              <ZoomOut className="h-3.5 w-3.5" />
            </Button>
            <button onClick={resetZoom} className="text-xs text-muted-foreground px-1.5 hover:text-foreground min-w-[3rem] text-center">
              {Math.round(zoom * 100)}%
            </button>
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={zoomIn} disabled={zoom >= 3}>
              <ZoomIn className="h-3.5 w-3.5" />
            </Button>
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={resetZoom}>
              <Maximize2 className="h-3.5 w-3.5" />
            </Button>
            <div className="w-px h-4 bg-border mx-1" />
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => goToPage(1)} disabled={currentPage <= 1}>
              <ChevronsLeft className="h-3.5 w-3.5" />
            </Button>
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => goToPage(currentPage - 1)} disabled={currentPage <= 1}>
              <ChevronLeft className="h-3.5 w-3.5" />
            </Button>
            <span className="text-xs text-muted-foreground px-1 min-w-[4rem] text-center">
              {currentPage} / {numPages || "..."}
            </span>
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => goToPage(currentPage + 1)} disabled={currentPage >= numPages}>
              <ChevronRight className="h-3.5 w-3.5" />
            </Button>
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => goToPage(numPages)} disabled={currentPage >= numPages}>
              <ChevronsRight className="h-3.5 w-3.5" />
            </Button>
            <div className="w-px h-4 bg-border mx-1" />
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => onOpenChange(false)}>
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* PDF content - continuous scroll with grab panning */}
        <div
          ref={handleWheelRef}
          className={`flex-1 overflow-auto bg-muted/30 ${panning ? "cursor-grabbing" : "cursor-grab"}`}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
        >
          <div className="flex flex-col items-center py-4 min-w-fit">
            {fileObj && (
              <Document
                file={fileObj}
                onLoadSuccess={({ numPages: n }) => setNumPages(n)}
                loading={<div className="text-sm text-muted-foreground p-8">Loading PDF...</div>}
                error={<div className="text-sm text-destructive p-8">Failed to load PDF</div>}
              >
                {Array.from({ length: numPages }, (_, i) => (
                  <div key={i + 1} id={`pdf-page-${i + 1}`} className="mb-2">
                    <div className="bg-zinc-800 p-[3px] rounded-sm">
                      <Page
                        pageNumber={i + 1}
                        width={Math.round(600 * zoom)}
                        renderTextLayer={false}
                        renderAnnotationLayer={false}
                      />
                    </div>
                  </div>
                ))}
              </Document>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}



/**
 * Hook for PDF preview: returns { openPreview, PreviewModal }.
 * Call openPreview(blobUrl, title?) to show the modal.
 */
export function usePdfPreview() {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewTitle, setPreviewTitle] = useState<string>("");

  const openPreview = useCallback((url: string, title?: string) => {
    setPreviewUrl((prev) => { if (prev) URL.revokeObjectURL(prev); return url; });
    setPreviewTitle(title || "PDF Preview");
  }, []);

  const PreviewModal = useCallback(() => (
    <PdfPreviewModal
      open={!!previewUrl}
      onOpenChange={(open) => { if (!open) { if (previewUrl) URL.revokeObjectURL(previewUrl); setPreviewUrl(null); } }}
      pdfUrl={previewUrl}
      title={previewTitle}
    />
  ), [previewUrl, previewTitle]);

  return { openPreview, PreviewModal };
}
