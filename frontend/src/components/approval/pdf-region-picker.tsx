"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import { ChevronLeft, ChevronRight, Crosshair } from "lucide-react";

import { Button } from "@/components/ui/button";

// PDF.js worker. react-pdf 10 ships matching pdfjs-dist; we point at the
// public CDN copy keyed off the runtime version so we can't drift.
if (typeof window !== "undefined") {
  pdfjs.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjs.version}/pdf.worker.min.mjs`;
}

import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";

export interface PdfRegion {
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

interface Props {
  fileUrl: string | null;
  armed: boolean;          // when true, drag captures a region
  onCapture: (region: PdfRegion) => void;
  onCancelArm: () => void;
}

export function PdfRegionPicker({ fileUrl, armed, onCapture, onCancelArm }: Props) {
  const [numPages, setNumPages] = useState(0);
  const [pageNumber, setPageNumber] = useState(1);
  const [dragging, setDragging] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [pageWidth, setPageWidth] = useState(700);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const startRef = useRef<{ x: number; y: number } | null>(null);
  // PDF native size in PDF user-space, used to convert canvas coords to bbox.
  const [pdfDims, setPdfDims] = useState<{ w: number; h: number } | null>(null);

  const fileObj = useMemo(() => (fileUrl ? { url: fileUrl } : null), [fileUrl]);

  useEffect(() => {
    setPageNumber(1);
    setDragging(null);
  }, [fileUrl]);

  useEffect(() => {
    if (!containerRef.current) return;
    const obs = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w) setPageWidth(Math.min(w - 16, 900));
    });
    obs.observe(containerRef.current);
    return () => obs.disconnect();
  }, []);

  const onPointerDown = (e: React.PointerEvent) => {
    if (!armed || !overlayRef.current) return;
    const rect = overlayRef.current.getBoundingClientRect();
    startRef.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    setDragging({ x: startRef.current.x, y: startRef.current.y, w: 0, h: 0 });
    overlayRef.current.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!startRef.current || !overlayRef.current) return;
    const rect = overlayRef.current.getBoundingClientRect();
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;
    const x = Math.min(cx, startRef.current.x);
    const y = Math.min(cy, startRef.current.y);
    const w = Math.abs(cx - startRef.current.x);
    const h = Math.abs(cy - startRef.current.y);
    setDragging({ x, y, w, h });
  };

  const onPointerUp = () => {
    if (!dragging || !overlayRef.current || !pdfDims) {
      startRef.current = null;
      return;
    }
    const overlayRect = overlayRef.current.getBoundingClientRect();
    if (dragging.w < 4 || dragging.h < 4) {
      // Too small — treat as a click, cancel arm.
      setDragging(null);
      startRef.current = null;
      onCancelArm();
      return;
    }
    // Convert overlay-pixel coords to PDF user-space.
    const scaleX = pdfDims.w / overlayRect.width;
    const scaleY = pdfDims.h / overlayRect.height;
    onCapture({
      page: pageNumber,
      x: dragging.x * scaleX,
      y: dragging.y * scaleY,
      width: dragging.w * scaleX,
      height: dragging.h * scaleY,
    });
    setDragging(null);
    startRef.current = null;
  };

  return (
    <div ref={containerRef} className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={pageNumber <= 1}
          onClick={() => setPageNumber((n) => Math.max(1, n - 1))}
        >
          <ChevronLeft className="h-3.5 w-3.5" />
        </Button>
        <span className="text-xs text-muted-foreground">
          Page {pageNumber} / {numPages || "—"}
        </span>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={pageNumber >= numPages}
          onClick={() => setPageNumber((n) => Math.min(numPages, n + 1))}
        >
          <ChevronRight className="h-3.5 w-3.5" />
        </Button>
        {armed && (
          <span className="ml-auto inline-flex items-center gap-1 text-xs text-sky-500">
            <Crosshair className="h-3.5 w-3.5" />
            Drag to capture
          </span>
        )}
      </div>

      <div className="relative border rounded-md overflow-auto bg-muted/20" style={{ maxHeight: 520 }}>
        {fileObj ? (
          <Document file={fileObj} onLoadSuccess={({ numPages }) => setNumPages(numPages)}>
            <Page
              pageNumber={pageNumber}
              width={pageWidth}
              renderAnnotationLayer={false}
              renderTextLayer={false}
              onLoadSuccess={(p: { width: number; height: number }) => setPdfDims({ w: p.width, h: p.height })}
            />
          </Document>
        ) : (
          <div className="p-8 text-center text-xs text-muted-foreground">No PDF selected</div>
        )}
        <div
          ref={overlayRef}
          className={
            "absolute inset-0 " +
            (armed ? "cursor-crosshair" : "pointer-events-none")
          }
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
        >
          {dragging && (
            <div
              className="absolute border-2 border-dashed border-sky-400/80 bg-sky-400/10"
              style={{
                left: dragging.x,
                top: dragging.y,
                width: dragging.w,
                height: dragging.h,
              }}
            />
          )}
        </div>
      </div>
    </div>
  );
}
