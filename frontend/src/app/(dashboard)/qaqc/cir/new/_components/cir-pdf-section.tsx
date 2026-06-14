"use client";

import { Loader2, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import api from "@/lib/api";

interface CirPdfSectionProps {
  editId: string | null;
  signed: { inspector1: boolean; inspector2: boolean };
  pdfLoading: boolean;
  setPdfLoading: (v: boolean) => void;
  projectId: string;
  setPdfPreviewUrl: (url: string | null) => void;
}

export function CirPdfSection({
  editId,
  signed,
  pdfLoading,
  setPdfLoading,
  projectId,
  setPdfPreviewUrl,
}: CirPdfSectionProps) {
  if (!editId) return null;

  const handlePreview = async () => {
    setPdfLoading(true);
    try {
      const res = await api.post(
        "/reports/generate/CIR",
        { document_id: editId, project_id: projectId },
        { responseType: "blob" },
      );
      const url = URL.createObjectURL(res.data);
      setPdfPreviewUrl(url);
    } finally {
      setPdfLoading(false);
    }
  };

  const handleDownload = async () => {
    if (!editId) return;
    try {
      const res = await api.get(`/documents/${editId}/bundle`, {
        responseType: "blob",
      });
      const disposition = res.headers?.["content-disposition"] || "";
      const match = disposition.match(/filename\*?=UTF-8''([^;]+)|filename="?([^";]+)"?/);
      const fname = match?.[1] || match?.[2] || `CIR_${editId}.pdf`;
      const url = URL.createObjectURL(res.data);
      const a = document.createElement("a");
      a.href = url;
      a.download = fname;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      // Silently fail
    }
  };

  return (
    <div className="flex gap-3 justify-end">
      <Button
        type="button"
        variant="outline"
        disabled={pdfLoading}
        onClick={handlePreview}
      >
        {pdfLoading ? (
          <Loader2 className="h-4 w-4 mr-1 animate-spin" />
        ) : null}
        Preview PDF
      </Button>
      <Button
        type="button"
        variant="outline"
        disabled={!(signed.inspector1 && signed.inspector2)}
        onClick={handleDownload}
      >
        <Download className="h-4 w-4 mr-1" />
        Download Document
      </Button>
    </div>
  );
}
