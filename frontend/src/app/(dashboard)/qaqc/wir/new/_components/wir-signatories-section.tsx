"use client";

import type { UseFormReturn } from "react-hook-form";
import type { WirFormValues, InspectorUser } from "../_lib/wir-form";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DatePicker } from "@/components/ui/date-picker";
import { TimePicker } from "@/components/ui/time-picker";
import { FormField, FormItem, FormLabel, FormControl, FormMessage } from "@/components/form";
import { SignatoryBlock } from "@/components/qaqc/signatory-block";

interface WirSignatoriesSectionProps {
  form: UseFormReturn<WirFormValues>;
  inspector1Id: string;
  inspector2Id: string;
  users: InspectorUser[];
  canSignFor: (id: string | undefined) => boolean;
  signed: { inspector1: boolean; inspector2: boolean };
  sigTouched: boolean;
  setSigTouched: (v: boolean) => void;
  currentUserId: string | undefined;
  editId: string | null;
  existingDoc: any;
  programmaticDirtyRef: React.MutableRefObject<boolean>;
  onSign: (role: "site_engineer" | "qaqc_engineer") => Promise<void>;
  onUnsign: (role: "site_engineer" | "qaqc_engineer") => Promise<void>;
}

export function WirSignatoriesSection({
  form, inspector1Id, inspector2Id, users, canSignFor, signed, sigTouched, setSigTouched,
  currentUserId, editId, existingDoc, programmaticDirtyRef, onSign, onUnsign,
}: WirSignatoriesSectionProps) {
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Signatories</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <div className="grid sm:grid-cols-2 gap-6">
          <SignatoryBlock
            control={form.control} name="inspector_1_id" remarksName="remarks_1" label="Signatory 1"
            users={users} selectedUserId={inspector1Id || ""} excludeUserId={inspector2Id || ""}
            canSign={canSignFor(inspector1Id)} isSigned={signed.inspector1} isTouched={sigTouched}
            currentUserId={currentUserId} isExistingDoc={!!editId} documentStatus={existingDoc?.status}
            documentCreatedBy={existingDoc?.created_by}
            onSelectChange={(v) => { form.setValue("inspector_1_id", v); programmaticDirtyRef.current = true; setSigTouched(true); }}
            onClear={() => { form.setValue("inspector_1_id", ""); if (signed.inspector1) onUnsign("site_engineer"); }}
            onSign={() => onSign("site_engineer")} onUnsign={() => onUnsign("site_engineer")}
          />
          <SignatoryBlock
            control={form.control} name="inspector_2_id" remarksName="remarks_2" label="Signatory 2"
            users={users} selectedUserId={inspector2Id || ""} excludeUserId={inspector1Id || ""}
            canSign={canSignFor(inspector2Id)} isSigned={signed.inspector2} isTouched={sigTouched}
            currentUserId={currentUserId} isExistingDoc={!!editId} documentStatus={existingDoc?.status}
            documentCreatedBy={existingDoc?.created_by}
            onSelectChange={(v) => { form.setValue("inspector_2_id", v); programmaticDirtyRef.current = true; setSigTouched(true); }}
            onClear={() => { form.setValue("inspector_2_id", ""); if (signed.inspector2) onUnsign("qaqc_engineer"); }}
            onSign={() => onSign("qaqc_engineer")} onUnsign={() => onUnsign("qaqc_engineer")}
          />
        </div>
        <div className="grid sm:grid-cols-2 gap-4">
          <FormField control={form.control} name="inspector_date_1" render={({ field }) => (
            <FormItem><FormLabel>Inspection Date *</FormLabel><FormControl><DatePicker value={field.value || undefined} onChange={(d) => field.onChange(d)} /></FormControl><FormMessage /></FormItem>
          )} />
          <FormField control={form.control} name="inspector_time_1" render={({ field }) => (
            <FormItem><FormLabel>Inspection Time</FormLabel><FormControl><TimePicker value={field.value || ""} onChange={field.onChange} /></FormControl><FormMessage /></FormItem>
          )} />
        </div>
      </CardContent>
    </Card>
  );
}
