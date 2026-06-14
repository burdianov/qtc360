"use client";

import { useRef, useEffect, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, Eye, Download } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Form,
  FormField,
  FormItem,
  FormLabel,
  FormControl,
  FormMessage,
} from "@/components/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { CenteredSpinner } from "@/components/loaders/centered-spinner";
import { PdfPreviewModal } from "@/components/pdf-preview-modal";
import { useCrsForm } from "./_lib/use-crs-form";
import { CrsSourceDocCard } from "./_components/crs-source-doc-card";
import { CrsContentTable } from "./_components/crs-content-table";

export default function NewCRSPage() {
  return (
    <Suspense fallback={<CenteredSpinner label="Loading document…" />}>
      <NewCRSPageInner />
    </Suspense>
  );
}

function NewCRSPageInner() {
  const searchParams = useSearchParams();
  const editId = searchParams.get("id");
  const wasNewRef = useRef(!editId);
  const [componentKey, setComponentKey] = useState(() => {
    if (!editId) return "new-" + Math.random().toString(36).slice(2);
    return editId;
  });

  useEffect(() => {
    if (!editId) {
      wasNewRef.current = true;
      setComponentKey("new-" + Math.random().toString(36).slice(2));
    } else if (wasNewRef.current) {
      wasNewRef.current = false;
    } else {
      setComponentKey(editId);
      wasNewRef.current = false;
    }
  }, [editId]);

  return <NewCRSPageContent key={componentKey} />;
}

function NewCRSPageContent() {
  const router = useRouter();
  const {
    form,
    mutation,
    editId,
    disciplines,
    refNumber,
    sourceDocType,
    setSourceDocType,
    sourceDocs,
    selectedSourceDocId,
    setSelectedSourceDocId,
    selectedSourceDoc,
    selectedApproverOrder,
    setSelectedApproverOrder,
    approvalRounds,
    getStatusLabel,
    rows,
    addRow,
    removeRow,
    updateRow,
    copyToClipboard,
    existingDoc,
    pdfPreviewUrl,
    setPdfPreviewUrl,
    handlePreview,
    handleDownload,
  } = useCrsForm();

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => router.push("/qaqc/crs")}
        >
          <ArrowLeft className="h-4 w-4 mr-1" />
          Back
        </Button>
        <h1 className="text-2xl font-semibold tracking-tight">
          {editId ? "Edit" : "New"} CRS
        </h1>
      </div>

      <Form {...form}>
        <form
          onSubmit={form.handleSubmit((v) => mutation.mutate(v), () => toast.error("Please fill in all required fields"))}
          noValidate
          className="space-y-6"
        >
          {/* Basic Info */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Basic Information</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-3">
              <FormField
                control={form.control}
                name="discipline_id"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Discipline *</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select discipline">
                            {disciplines.find((d) => d.id === field.value)
                              ?.name || ""}
                          </SelectValue>
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {disciplines.map((d) => (
                          <SelectItem key={d.id} value={d.id}>
                            {d.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormItem>
                <FormLabel>Reference Number</FormLabel>
                <Input
                  value={refNumber}
                  readOnly
                  className="bg-muted"
                  placeholder="Reference will be assigned on save"
                />
              </FormItem>
              <FormItem>
                <FormLabel>Revision</FormLabel>
                <Input
                  value={existingDoc?.revision_no ?? 0}
                  readOnly
                  className="bg-muted"
                />
              </FormItem>
            </CardContent>
          </Card>

          <CrsSourceDocCard
            sourceDocType={sourceDocType}
            setSourceDocType={setSourceDocType}
            setSelectedSourceDocId={setSelectedSourceDocId}
            setSelectedApproverOrder={setSelectedApproverOrder}
            selectedSourceDocId={selectedSourceDocId}
            selectedSourceDoc={selectedSourceDoc}
            sourceDocs={sourceDocs}
            selectedApproverOrder={selectedApproverOrder}
            approvalRounds={approvalRounds}
            getStatusLabel={getStatusLabel}
            copyToClipboard={copyToClipboard}
          />

          <CrsContentTable
            form={form}
            rows={rows}
            addRow={addRow}
            removeRow={removeRow}
            updateRow={updateRow}
          />

          {/* Actions */}
          <div className="flex justify-end gap-3">
            <Button type="button" variant="outline" onClick={handlePreview}>
              <Eye className="h-4 w-4 mr-1" />
              Preview PDF
            </Button>
            <Button type="button" variant="outline" onClick={handleDownload}>
              <Download className="h-4 w-4 mr-1" />
              Download PDF
            </Button>
            <Button
              type="submit"
              disabled={mutation.isPending}
              aria-busy={mutation.isPending || undefined}
            >
              {mutation.isPending && (
                <Spinner size="sm" className="mr-1 text-current" />
              )}
              {mutation.isPending ? "Saving…" : "Save"}
            </Button>
          </div>
        </form>
      </Form>
      <PdfPreviewModal
        open={!!pdfPreviewUrl}
        onOpenChange={(o) => {
          if (!o) {
            if (pdfPreviewUrl) URL.revokeObjectURL(pdfPreviewUrl);
            setPdfPreviewUrl(null);
          }
        }}
        pdfUrl={pdfPreviewUrl}
        title="CRS Preview"
      />
    </div>
  );
}
