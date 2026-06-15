"use client";

import { Suspense } from "react";
import { ArrowLeft } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Form } from "@/components/form";
import { Spinner } from "@/components/ui/spinner";
import { FormSkeleton } from "@/components/loaders/form-skeleton";
import { useFatForm } from "./_lib/use-fat-form";
import { FatGeneralInfoCard } from "./_components/fat-general-info-card";
import { FatLinkageCard } from "./_components/fat-linkage-card";

export default function NewFATPage() {
  return (
    <Suspense fallback={<FormSkeleton fields={4} />}>
      <NewFATPageContent />
    </Suspense>
  );
}

function NewFATPageContent() {
  const {
    form,
    mutation,
    handleBack,
    editId,
    disciplines,
    assets,
    allAssetRequirements,
    commissioningLinkage,
    setCommissioningLinkage,
    linkageDirtyRef,
  } = useFatForm();

  if (!disciplines.length) return <FormSkeleton fields={4} />;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="sm" onClick={handleBack}>
          <ArrowLeft className="h-4 w-4 mr-1" />
          Back
        </Button>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {editId ? "Edit" : "New"} Factory Acceptance Test
          </h1>
          <p className="text-sm text-muted-foreground">Fill in the FAT form</p>
        </div>
      </div>

      <Form {...form}>
        <form
          onSubmit={form.handleSubmit((v) => mutation.mutate(v), () => toast.error("Please fill in all required fields"))}
          noValidate
          className="space-y-6"
        >
          <FatGeneralInfoCard form={form} disciplines={disciplines} />

          <FatLinkageCard
            assets={assets}
            allAssetRequirements={allAssetRequirements}
            editId={editId}
            commissioningLinkage={commissioningLinkage}
            setCommissioningLinkage={setCommissioningLinkage}
            linkageDirtyRef={linkageDirtyRef}
          />

          <div className="flex justify-end gap-3">
            <Button type="button" variant="outline" onClick={handleBack}>
              Cancel
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
    </div>
  );
}
