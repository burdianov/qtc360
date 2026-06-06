"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ClipboardCheck, Download, Eye, Trash2 } from "lucide-react";
import { toast } from "sonner";
import api from "@/lib/api";
import { Button } from "@/components/ui/button";
import { FillChecklistModal } from "@/components/fill-checklist-modal";

interface Props {
  documentId: string;
  requirementTemplateId: string;
  requirementName: string;
}

export function DocumentChecklistButtons({ documentId, requirementTemplateId, requirementName }: Props) {
  const queryClient = useQueryClient();
  const [fillOpen, setFillOpen] = useState(false);

  const { data: checklists = [] } = useQuery<any[]>({
    queryKey: ["document-checklists", documentId],
    queryFn: async () => (await api.get(`/checklists/documents/${documentId}`)).data,
    enabled: !!documentId,
  });

  const existing = checklists.find((c: any) => c.requirement_template_id === requirementTemplateId);

  const removeMutation = useMutation({
    mutationFn: () => api.delete(`/checklists/documents/${documentId}/${requirementTemplateId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["document-checklists", documentId] });
      queryClient.invalidateQueries({ queryKey: ["document-attachments", documentId] });
      toast.success("Checklist removed");
    },
  });

  const handlePreview = async () => {
    try {
      const res = await api.get(`/checklists/documents/${documentId}/${requirementTemplateId}/pdf`, {
        responseType: "blob",
      });
      const url = URL.createObjectURL(res.data);
      window.open(url, "_blank");
    } catch {
      toast.error("Failed to preview checklist");
    }
  };

  const handleDownload = async () => {
    try {
      const res = await api.get(`/checklists/documents/${documentId}/${requirementTemplateId}/pdf`, {
        responseType: "blob",
      });
      const url = URL.createObjectURL(res.data);
      const a = document.createElement("a");
      a.href = url;
      a.download = `Checklist - ${requirementName}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      toast.error("Failed to download checklist");
    }
  };

  return (
    <>
      <div className="flex items-center gap-1.5 mt-1.5">
        <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setFillOpen(true)}>
          <ClipboardCheck className="h-3.5 w-3.5 mr-1" />
          {existing ? "Edit Checklist" : "Fill Checklist"}
        </Button>
        {existing && (
          <>
            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={handlePreview}>
              <Eye className="h-3.5 w-3.5 mr-1" />Preview
            </Button>
            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={handleDownload}>
              <Download className="h-3.5 w-3.5 mr-1" />Download
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs text-destructive hover:text-destructive"
              onClick={() => removeMutation.mutate()}
              disabled={removeMutation.isPending}
            >
              <Trash2 className="h-3.5 w-3.5 mr-1" />Remove
            </Button>
          </>
        )}
      </div>
      <FillChecklistModal
        open={fillOpen}
        onOpenChange={setFillOpen}
        documentId={documentId}
        requirementTemplateId={requirementTemplateId}
        requirementName={requirementName}
      />
    </>
  );
}
