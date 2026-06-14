"use client";

import { Loader2, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";
import api from "@/lib/api";

interface WirPdfSectionProps {
  editId: string | null;
  signed: { inspector1: boolean; inspector2: boolean };
  pdfLoading: boolean;
  setPdfLoading: (v: boolean) => void;
  projectId: string;
  setPdfPreviewUrl: (url: string | null) => void;
}

export function WirPdfSection({
  editId,
  signed,
  pdfLoading,
  setPdfLoading,
  projectId,
  setPdfPreviewUrl,
}: WirPdfSectionProps) {
  const needsSave = !editId;

  const handlePreview = async () => {
    setPdfLoading(true);
    try {
      const res = await api.post("/reports/generate/WIR", {
        document_id: editId,
        project_id: projectId,
      }, { responseType: "blob" });
      setPdfPreviewUrl(URL.createObjectURL(res.data));
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
      const match = disposition.match(
        /filename\*?=UTF-8''([^;]+)|filename="?([^";]+)"?/,
      );
      const fname =
        match?.[1] || match?.[2] || `WIR_${editId}.pdf`;
      const url = URL.createObjectURL(res.data);
      const a = document.createElement("a");
      a.href = url;
      a.download = fname;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      /* Silently fail */
    }
  };

  const previewBtn = (
    <Button
      type="button"
      variant="outline"
      disabled={pdfLoading || needsSave}
      onClick={handlePreview}
    >
      {pdfLoading ? (
        <Loader2 className="h-4 w-4 mr-1 animate-spin" />
      ) : null}
      Preview PDF
    </Button>
  );

  const downloadBtn = (
    <Button
      type="button"
      variant="outline"
      disabled={needsSave || !(signed.inspector1 && signed.inspector2)}
      onClick={handleDownload}
    >
      <Download className="h-4 w-4 mr-1" />
      Download Document
    </Button>
  );

  return (
    <div className="flex gap-3 justify-end">
      {needsSave ? (
        <Tooltip>
          <TooltipTrigger render={previewBtn} />
          <TooltipContent>Save the document first</TooltipContent>
        </Tooltip>
      ) : (
        previewBtn
      )}
      {needsSave ? (
        <Tooltip>
          <TooltipTrigger render={downloadBtn} />
          <TooltipContent>Save the document first</TooltipContent>
        </Tooltip>
      ) : (
        downloadBtn
      )}
    </div>
  );
}
