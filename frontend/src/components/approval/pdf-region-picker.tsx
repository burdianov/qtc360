"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState, forwardRef, useImperativeHandle } from "react";
import { Document, Page, pdfjs } from "react-pdf";

import { cn } from "@/lib/utils";

if (typeof window !== "undefined") {
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/build/pdf.worker.min.mjs",
    import.meta.url
  ).toString();
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
  armed: boolean;
  onCapture: (region: PdfRegion) => void;
  onCancelArm: () => void;
}

const ZOOM_MIN = 0.2;
const ZOOM_MAX = 3;
const ZOOM_STEP = 0.1;
const MIN_DRAG_PX = 4;

export interface PdfPickerHandle {
  zoomIn: () => void;
  zoomOut: () => void;
  resetZoom: () => void;
  fitWidth: () => void;
  goToPage: (p: number) => void;
  goFirst: () => void;
  goLast: () => void;
  goPrev: () => void;
  goNext: () => void;
  getState: () => { zoom: number; visiblePage: number; numPages: number; canZoomIn: boolean; canZoomOut: boolean };
}

export const PdfRegionPicker = forwardRef<PdfPickerHandle, Props>(function PdfRegionPicker({ fileUrl, armed, onCapture, onCancelArm }, ref) {
  const [numPages, setNumPages] = useState(0);
  const [dragging, setDragging] = useState<{ x: number; y: number; w: number; h: number; page: number } | null>(null);
  const [panning, setPanning] = useState(false);
  const [baseWidth, setBaseWidth] = useState(700);
  const [zoom, setZoom] = useState<number>(1);
  const [canPan, setCanPan] = useState(false);
  const [visiblePage, setVisiblePage] = useState(1);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const startRef = useRef<{ x: number; y: number; page: number } | null>(null);
  const panRef = useRef<{ x: number; y: number; scrollLeft: number; scrollTop: number } | null>(null);
  const pageDimsRef = useRef<Map<number, { w: number; h: number }>>(new Map());
  const pageRefsMap = useRef<Map<number, HTMLDivElement>>(new Map());

  const fileObj = useMemo(() => (fileUrl ? { url: fileUrl } : null), [fileUrl]);
  const pageWidth = Math.round(baseWidth * zoom);

  useEffect(() => {
    setNumPages(0);
    setDragging(null);
    setPanning(false);
    setZoom(1);
    pageDimsRef.current.clear();
  }, [fileUrl]);

  useLayoutEffect(() => {
    const c = containerRef.current;
    if (!c) return;
    const measure = () => {
      const w = c.getBoundingClientRect().width;
      if (w) setBaseWidth(Math.min(w - 16, 1100));
      setCanPan(c.scrollWidth > c.clientWidth + 1 || c.scrollHeight > c.clientHeight + 1);
    };
    measure();
    const obs = new ResizeObserver(measure);
    obs.observe(c);
    if (contentRef.current) obs.observe(contentRef.current);
    return () => obs.disconnect();
  }, [zoom, fileUrl, numPages]);

  // Track which page is currently most visible
  useEffect(() => {
    if (!containerRef.current || numPages === 0) return;
    // Capture the observer in the outer scope so the effect's cleanup can
    // disconnect it. The previous implementation returned the cleanup from
    // inside the setTimeout callback — setTimeout ignores that return value,
    // so the IntersectionObserver leaked on every file change.
    let observer: IntersectionObserver | null = null;
    const timeoutId = setTimeout(() => {
      const c = containerRef.current;
      if (!c) return;
      observer = new IntersectionObserver(
        (entries) => {
          let maxRatio = 0;
          let maxPage = 1;
          for (const entry of entries) {
            const pageNum = Number(entry.target.getAttribute("data-page"));
            if (entry.intersectionRatio > maxRatio) {
              maxRatio = entry.intersectionRatio;
              maxPage = pageNum;
            }
          }
          if (maxRatio > 0) setVisiblePage(maxPage);
        },
        { root: c, threshold: [0, 0.1, 0.25, 0.5, 0.75, 1] },
      );
      for (const [, el] of pageRefsMap.current) observer.observe(el);
    }, 300);
    return () => {
      clearTimeout(timeoutId);
      observer?.disconnect();
    };
  }, [numPages, fileUrl]);

  // Also update visible page on scroll (fallback for observer)
  useEffect(() => {
    const c = containerRef.current;
    if (!c || numPages === 0) return;
    const onScroll = () => {
      const cRect = c.getBoundingClientRect();
      const cCenter = cRect.top + cRect.height / 2;
      let closest = 1;
      let closestDist = Infinity;
      for (const [pageNum, el] of pageRefsMap.current) {
        const rect = el.getBoundingClientRect();
        const dist = Math.abs(rect.top + rect.height / 2 - cCenter);
        if (dist < closestDist) { closestDist = dist; closest = pageNum; }
      }
      setVisiblePage(closest);
    };
    c.addEventListener("scroll", onScroll, { passive: true });
    return () => c.removeEventListener("scroll", onScroll);
  }, [numPages, fileUrl]);

  // Ctrl+Wheel zoom
  useEffect(() => {
    const c = containerRef.current;
    if (!c) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      setZoom((prev) => {
        const delta = e.deltaY > 0 ? -ZOOM_STEP : ZOOM_STEP;
        return Math.round(Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, prev + delta)) * 100) / 100;
      });
    };
    c.addEventListener("wheel", onWheel, { passive: false });
    return () => c.removeEventListener("wheel", onWheel);
  }, [fileUrl]);

  const scrollToPage = (pageNum: number) => {
    const el = pageRefsMap.current.get(pageNum);
    if (el && containerRef.current) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  };

  useImperativeHandle(ref, () => ({
    zoomIn: () => setZoom((z) => Math.round(Math.min(ZOOM_MAX, z + ZOOM_STEP) * 100) / 100),
    zoomOut: () => setZoom((z) => Math.round(Math.max(ZOOM_MIN, z - ZOOM_STEP) * 100) / 100),
    resetZoom: () => setZoom(1),
    fitWidth: () => { if (containerRef.current) { setBaseWidth(Math.min(containerRef.current.getBoundingClientRect().width - 16, 1100)); setZoom(1); } },
    goToPage: (p: number) => { if (p >= 1 && p <= numPages) scrollToPage(p); },
    goFirst: () => scrollToPage(1),
    goLast: () => scrollToPage(numPages),
    goPrev: () => { if (visiblePage > 1) scrollToPage(visiblePage - 1); },
    goNext: () => { if (visiblePage < numPages) scrollToPage(visiblePage + 1); },
    getState: () => ({ zoom, visiblePage, numPages, canZoomIn: zoom < ZOOM_MAX - 0.01, canZoomOut: zoom > ZOOM_MIN + 0.01 }),
  }), [zoom, visiblePage, numPages]);

  const getPageAtPoint = (clientX: number, clientY: number): { page: number; localX: number; localY: number } | null => {
    for (const [pageNum, el] of pageRefsMap.current.entries()) {
      const rect = el.getBoundingClientRect();
      if (clientY >= rect.top && clientY <= rect.bottom && clientX >= rect.left && clientX <= rect.right) {
        return { page: pageNum, localX: clientX - rect.left, localY: clientY - rect.top };
      }
    }
    return null;
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (!overlayRef.current || !fileObj) return;
    overlayRef.current.setPointerCapture(e.pointerId);
    if (armed) {
      const hit = getPageAtPoint(e.clientX, e.clientY);
      if (hit) {
        startRef.current = { x: hit.localX, y: hit.localY, page: hit.page };
        setDragging({ x: hit.localX, y: hit.localY, w: 0, h: 0, page: hit.page });
      }
    } else if (containerRef.current) {
      panRef.current = {
        x: e.clientX,
        y: e.clientY,
        scrollLeft: containerRef.current.scrollLeft,
        scrollTop: containerRef.current.scrollTop,
      };
      setPanning(true);
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (panning && panRef.current && containerRef.current) {
      const c = containerRef.current;
      const dx = e.clientX - panRef.current.x;
      const dy = e.clientY - panRef.current.y;
      c.scrollLeft = Math.max(0, Math.min(c.scrollWidth - c.clientWidth, panRef.current.scrollLeft - dx));
      c.scrollTop = Math.max(0, Math.min(c.scrollHeight - c.clientHeight, panRef.current.scrollTop - dy));
    } else if (startRef.current && dragging) {
      const pageEl = pageRefsMap.current.get(startRef.current.page);
      if (!pageEl) return;
      const rect = pageEl.getBoundingClientRect();
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;
      const x = Math.min(cx, startRef.current.x);
      const y = Math.min(cy, startRef.current.y);
      const w = Math.abs(cx - startRef.current.x);
      const h = Math.abs(cy - startRef.current.y);
      setDragging({ x, y, w, h, page: startRef.current.page });
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    overlayRef.current?.releasePointerCapture(e.pointerId);
    if (panning) {
      setPanning(false);
      panRef.current = null;
      return;
    }
    if (dragging && startRef.current) {
      if (dragging.w < MIN_DRAG_PX || dragging.h < MIN_DRAG_PX) {
        setDragging(null);
        startRef.current = null;
        onCancelArm();
        return;
      }
      const dims = pageDimsRef.current.get(dragging.page);
      const pageEl = pageRefsMap.current.get(dragging.page);
      if (dims && pageEl) {
        const rect = pageEl.getBoundingClientRect();
        const scaleX = dims.w / rect.width;
        const scaleY = dims.h / rect.height;
        onCapture({
          page: dragging.page,
          x: dragging.x * scaleX,
          y: dragging.y * scaleY,
          width: dragging.w * scaleX,
          height: dragging.h * scaleY,
        });
      }
      setDragging(null);
      startRef.current = null;
    }
  };

  const onPointerCancel = (e: React.PointerEvent) => {
    overlayRef.current?.releasePointerCapture(e.pointerId);
    setPanning(false);
    panRef.current = null;
    setDragging(null);
    startRef.current = null;
  };

  const _canZoomOut = zoom > ZOOM_MIN + 0.01;
  const _canZoomIn = zoom < ZOOM_MAX - 0.01;

  const cursorClass = !fileObj
    ? ""
    : armed
      ? "cursor-crosshair"
      : panning
        ? "cursor-grabbing"
        : canPan
          ? "cursor-grab"
          : "";

  return (
    <div className="flex flex-col h-full min-h-0 select-none">
      <div
        ref={containerRef}
        className="relative border rounded-md overflow-auto bg-muted/20 flex-1 min-h-0"
      >
        <div ref={contentRef} className="flex flex-col items-center py-4 gap-0" style={{ minWidth: zoom > 1 ? pageWidth + 16 : undefined }}>
          {fileObj ? (
            <Document
              file={fileObj}
              onLoadSuccess={({ numPages: n }) => setNumPages(n)}
              loading={<div className="p-8 text-center text-xs text-muted-foreground">Loading PDF…</div>}
            >
              {Array.from({ length: numPages }, (_, i) => i + 1).map((pageNum) => (
                <div key={pageNum} className="flex flex-col items-center">
                  {pageNum > 1 && (
                    <div className="w-full px-6 py-1">
                      <div className="h-[0.33px] bg-border/30" />
                    </div>
                  )}
                  <div
                    ref={(el) => { if (el) pageRefsMap.current.set(pageNum, el); else pageRefsMap.current.delete(pageNum); }}
                    data-page={pageNum}
                    className="relative shadow-md"
                  >
                  <Page
                    pageNumber={pageNum}
                    width={pageWidth}
                    renderAnnotationLayer={false}
                    renderTextLayer={false}
                    onLoadSuccess={(p: any) => pageDimsRef.current.set(pageNum, { w: p.originalWidth || p.width, h: p.originalHeight || p.height })}
                  />
                  {dragging && dragging.page === pageNum && (
                    <div
                      className="absolute border-2 border-dashed border-sky-400/80 bg-sky-400/10 pointer-events-none"
                      style={{ left: dragging.x, top: dragging.y, width: dragging.w, height: dragging.h }}
                    />
                  )}
                </div>
                </div>
              ))}
            </Document>
          ) : (
            <div className="flex h-64 items-center justify-center text-center">
              <div className="space-y-1">
                <p className="text-sm font-medium text-muted-foreground">No PDF loaded</p>
                <p className="text-xs text-muted-foreground/70">Select a returned PDF to preview</p>
              </div>
            </div>
          )}
        </div>
        <div
          ref={overlayRef}
          className={cn("absolute inset-0 touch-none", cursorClass)}
          style={{ minWidth: zoom > 1 ? pageWidth + 16 : undefined, minHeight: contentRef.current?.scrollHeight }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerCancel}
        />
      </div>
    </div>
  );
});
