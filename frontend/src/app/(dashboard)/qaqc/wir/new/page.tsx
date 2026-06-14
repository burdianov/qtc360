"use client";

import { useRef, useEffect, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { Send, ArrowLeft } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Form } from "@/components/form";
import { Spinner } from "@/components/ui/spinner";
import { CenteredSpinner } from "@/components/loaders/centered-spinner";
import { CommissioningLinkagePanel } from "@/components/commissioning-linkage";
import { RequirementSelector } from "@/components/requirement-selector";
import { ApprovalActionPanel } from "@/components/approval/approval-action-panel";
import { PdfPreviewModal } from "@/components/pdf-preview-modal";
import { DocumentAttachments } from "@/components/document-attachments";
import api from "@/lib/api";
import { useWirForm } from "./_lib/use-wir-form";
import { WirGeneralInfoCard } from "./_components/wir-general-info-card";
import { WirSubmissionModeCard } from "./_components/wir-submission-mode-card";
import { WirSignatoriesSection } from "./_components/wir-signatories-section";
import { WirPdfSection } from "./_components/wir-pdf-section";

export default function NewWIRPage() {
  return (
    <Suspense fallback={<CenteredSpinner label="Loading document…" />}>
      <NewWIRPageInner />
    </Suspense>
  );
}

function NewWIRPageInner() {
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

  return <NewWIRPageContent key={componentKey} />;
}

function NewWIRPageContent() {
  const queryClient = useQueryClient();
  const wir = useWirForm();
  const [pdfLoading, setPdfLoading] = useState(false);

  const {
    form, formLocked, programmaticDirtyRef, projectId,
    disciplines, users, canSignFor, assets, docTemplates, allTemplates,
    allAssetRequirements, rejectedDocs, existingDoc, editId,
    attachments, setAttachments, signed, sigTouched, setSigTouched,
    commissioningLinkage, setCommissioningLinkage, linkageDirtyRef, restoringLinkageRef,
    selectedRequirements, setSelectedRequirements, pendingChecklists, setPendingChecklists, restoringSelectedRef,
    referenceNo, revisionNo, selectedTemplateId, setSelectedTemplateId,
    pdfPreviewUrl, setPdfPreviewUrl, submissionMode, setSubmissionMode, revisionOfId, setRevisionOfId,
    currentUser, inspector1Id, inspector2Id, applicableTemplateIds,
    mutation, notifyMutation, handleSign, handleUnsign, handleBack, refetchAttachments, handlePreviewAttachment,
  } = wir;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="sm" onClick={handleBack}>
          <ArrowLeft className="h-4 w-4 mr-1" /> Back
        </Button>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {editId ? "Edit" : "New"} Work Inspection Request
          </h1>
          <p className="text-sm text-muted-foreground">Fill in the WIR form</p>
        </div>
      </div>

      <Form {...form}>
        <form
          onSubmit={form.handleSubmit((v) => mutation.mutate(v), () => toast.error("Please fill in all required fields"))}
          noValidate
          className="space-y-6"
        >
          <WirSubmissionModeCard
            isEdit={!!editId} submissionMode={submissionMode} setSubmissionMode={setSubmissionMode}
            rejectedDocs={rejectedDocs} disciplines={disciplines}
            revisionOfId={revisionOfId} setRevisionOfId={setRevisionOfId}
            programmaticDirtyRef={programmaticDirtyRef}
          />

          <fieldset disabled={formLocked} className="disabled:opacity-60 disabled:pointer-events-none">
            <WirGeneralInfoCard
              form={form} disciplines={disciplines} docTemplates={docTemplates}
              selectedTemplateId={selectedTemplateId} setSelectedTemplateId={setSelectedTemplateId}
              programmaticDirtyRef={programmaticDirtyRef} referenceNo={referenceNo} revisionNo={revisionNo}
            />
          </fieldset>

          <Card>
            <CardContent className="pt-6">
              <RequirementSelector
                projectId={projectId || ""} documentType="WIR" documentId={editId || undefined}
                applicableTemplateIds={applicableTemplateIds}
                selectedRequirements={selectedRequirements}
                onRequirementsChange={(reqs) => { if (!restoringSelectedRef.current) { setSelectedRequirements(reqs); programmaticDirtyRef.current = true; } }}
                pendingChecklists={pendingChecklists} onPendingChecklistsChange={setPendingChecklists}
                onChecklistSaved={refetchAttachments}
              />
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-6">
              <CommissioningLinkagePanel
                allAssetIds={assets.map((a) => a.id)}
                allAssetLabels={Object.fromEntries(assets.map((a) => [a.id, a.tag_number || a.name]))}
                allAssetNames={Object.fromEntries(assets.map((a) => [a.id, a.name]))}
                allAssetRequirements={allAssetRequirements} documentType="WIR"
                templates={allTemplates} selectedRequirements={selectedRequirements}
                value={commissioningLinkage}
                onChange={(linkage) => { if (!restoringLinkageRef.current) { setCommissioningLinkage(linkage); linkageDirtyRef.current = true; programmaticDirtyRef.current = true; } }}
                onUnlinkAssets={async (tmplId, assetIds) => {
                  if (!editId) return;
                  for (const assetId of assetIds) {
                    const arRes = await api.get("/commissioning/asset-requirements", { params: { asset_id: assetId } });
                    const ar = (arRes.data as any[]).find((r: any) => r.requirement_template_id === tmplId);
                    if (ar) await api.delete("/commissioning/document-links", { params: { document_id: editId, asset_requirement_id: ar.id } }).catch(() => {});
                  }
                }}
              />
            </CardContent>
          </Card>

          <fieldset disabled={formLocked} className="disabled:opacity-60 disabled:pointer-events-none space-y-6">
            <WirSignatoriesSection
              form={form} inspector1Id={inspector1Id || ""} inspector2Id={inspector2Id || ""}
              users={users} canSignFor={canSignFor} signed={signed} sigTouched={sigTouched} setSigTouched={setSigTouched}
              currentUserId={currentUser?.id} editId={editId} existingDoc={existingDoc}
              programmaticDirtyRef={programmaticDirtyRef} onSign={handleSign} onUnsign={handleUnsign}
            />

            <Card>
              <CardContent className="pt-6">
                <DocumentAttachments
                  documentId={editId || undefined} attachments={attachments}
                  onAttachmentsChange={(newAtts) => { setAttachments(newAtts); programmaticDirtyRef.current = true; }}
                  onPreviewAttachment={handlePreviewAttachment}
                />
              </CardContent>
            </Card>

            {!formLocked && (
              <div className="flex justify-end gap-3">
                <Button type="button" variant="outline" onClick={handleBack}>Cancel</Button>
                <Button
                  type="submit"
                  variant="secondary"
                  disabled={
                    mutation.isPending ||
                    notifyMutation.isPending ||
                    (!programmaticDirtyRef.current && !form.formState.isDirty)
                  }
                >
                  {mutation.isPending && <Spinner size="sm" className="mr-1 text-current" />}
                  {mutation.isPending ? "Saving…" : "Save as Draft"}
                </Button>
                <Button
                  type="button"
                  disabled={
                    !editId ||
                    notifyMutation.isPending ||
                    (signed.inspector1 && signed.inspector2) ||
                    !inspector1Id ||
                    !inspector2Id
                  }
                  onClick={() => notifyMutation.mutate()}
                >
                  <Send className="h-4 w-4 mr-1" />
                  {notifyMutation.isPending ? "Notifying…" : "Notify Signatory"}
                </Button>
              </div>
            )}
          </fieldset>
        </form>
      </Form>

      <WirPdfSection editId={editId} signed={signed} pdfLoading={pdfLoading} setPdfLoading={setPdfLoading} projectId={projectId || ""} setPdfPreviewUrl={setPdfPreviewUrl} />

      {editId && existingDoc && existingDoc.status !== "draft" && (
        <Card><CardContent className="pt-6">
          <ApprovalActionPanel
            documentId={editId} projectId={projectId} documentType="WIR"
            documentStatus={existingDoc.status} documentTitle={existingDoc.title}
            disciplineId={existingDoc.discipline_id}
            onChanged={() => { queryClient.invalidateQueries({ queryKey: ["document", editId] }); }}
          />
        </CardContent></Card>
      )}

      <PdfPreviewModal
        open={!!pdfPreviewUrl} onOpenChange={(o) => { if (!o) { if (pdfPreviewUrl) URL.revokeObjectURL(pdfPreviewUrl); setPdfPreviewUrl(null); } }}
        pdfUrl={pdfPreviewUrl} title="WIR Preview"
      />
    </div>
  );
}
