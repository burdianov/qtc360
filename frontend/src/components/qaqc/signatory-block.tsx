"use client";

import { X } from "lucide-react";
import type { Control, FieldPath, FieldValues } from "react-hook-form";
import {
  FormControl,
  FormField,
  FormItem,
  FormLabel,
} from "@/components/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { SignatureImage } from "@/components/SignatureImage";

interface InspectorUser {
  id: string;
  full_name: string;
  designation: { id: string; name: string } | null;
  signature_text: string | null;
  signature_font: string | null;
  has_signature: boolean;
}

export interface SignatoryBlockProps<
  T extends FieldValues = FieldValues,
> {
  /** react-hook-form control */
  control: Control<T>;
  /** Field name for the inspector ID (e.g. "inspector_1_id") */
  name: FieldPath<T>;
  /** Field name for remarks (e.g. "remarks_1") */
  remarksName?: FieldPath<T>;
  /** Label shown above the select */
  label: string;
  /** Clear button aria-label */
  ariaLabel?: string;
  /** Available users for the dropdown */
  users: InspectorUser[];
  /** Current value of this signatory's ID (from form.watch) */
  selectedUserId: string;
  /** Another inspector's ID to exclude from the dropdown (for mutual exclusion) */
  excludeUserId: string;
  /** Whether the current user can sign for the selected user */
  canSign: boolean;
  /** Whether the signature is already applied */
  isSigned: boolean;
  /** Has the user changed this select (to show warnings) */
  isTouched: boolean;
  /** Current user (for the disabled state check) */
  currentUserId: string | undefined;
  /** Is this an existing document being edited */
  isExistingDoc: boolean | undefined;
  /** Current document status */
  documentStatus: string | undefined;
  /** Document creator ID */
  documentCreatedBy: string | undefined;
  /** Called when the select value changes */
  onSelectChange: (value: string) => void;
  /** Called to clear the select */
  onClear: () => void;
  /** Called when the signature box is clicked */
  onSign: () => void;
  /** Called when unsign is clicked */
  onUnsign: () => void;
}

/**
 * A signatory selection and signature block used in MIR, CIR, WIR forms.
 *
 * Includes: user select dropdown, clear button, signing warnings,
 * click-to-sign area with SignatureImage, and remarks textarea.
 */
export function SignatoryBlock<T extends FieldValues = FieldValues>({
  control,
  name,
  remarksName,
  label,
  ariaLabel,
  users,
  selectedUserId,
  excludeUserId,
  canSign,
  isSigned,
  isTouched,
  currentUserId,
  isExistingDoc,
  documentStatus,
  documentCreatedBy,
  onSelectChange,
  onClear,
  onSign,
  onUnsign,
}: SignatoryBlockProps<T>) {

  // Only the document creator can change signatories on non-draft docs
  const selectDisabled =
    !!isExistingDoc &&
    documentStatus !== "draft" &&
    currentUserId !== documentCreatedBy;

  const canUnsign =
    !isExistingDoc ||
    documentStatus === "draft" ||
    documentStatus === "internally_signed";

  return (
    <div className="space-y-3">
      <FormField
        control={control}
        name={name}
        render={({ field }) => (
          <FormItem>
            <FormLabel>{label}</FormLabel>
            <div className="flex gap-1.5 w-[48%]">
              <div className="flex-1 min-w-0">
                <Select
                  onValueChange={onSelectChange}
                  value={field.value}
                  disabled={selectDisabled}
                >
                  <FormControl>
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Name and Designation">
                        {field.value
                          ? `${
                              users.find((u) => u.id === field.value)
                                ?.full_name || ""
                            }`
                          : ""}
                      </SelectValue>
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {users
                      .filter((u) => u.id !== excludeUserId)
                      .map((u) => (
                        <SelectItem key={u.id} value={u.id}>
                          <span className="inline-flex items-baseline gap-2 w-full">
                            <span>{u.full_name}:</span>
                            <span className="text-muted-foreground">
                              {u.designation?.name || "-"}
                            </span>
                          </span>
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
              {field.value && (
                <button
                  type="button"
                  className="shrink-0 p-2 rounded-md border hover:bg-destructive/10 text-muted-foreground hover:text-destructive"
                  aria-label={ariaLabel || `Clear ${label}`}
                  onClick={onClear}
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
            {isTouched &&
              field.value &&
              field.value !== currentUserId &&
              !canSign && (
                <p className="text-xs text-amber-600">
                  You don't have signing rights for this user
                </p>
              )}
            {field.value &&
              canSign &&
              !users.find((u) => u.id === field.value)?.has_signature && (
                <p className="text-xs text-amber-600">
                  No signature uploaded for this user
                </p>
              )}
          </FormItem>
        )}
      />
      <div
        className={`h-14 rounded-md border-2 border-dashed flex items-center justify-center transition-colors relative ${
          isSigned
            ? "border-emerald-500/50 bg-emerald-500/5"
            : canSign
              ? "border-border hover:border-primary/50 cursor-pointer"
              : "border-border opacity-50 cursor-not-allowed"
        }`}
        onClick={() => {
          if (canSign && !isSigned) onSign();
        }}
      >
        {isSigned ? (
          <>
            <SignatureImage userId={selectedUserId} />
            {canUnsign && (
              <button
                type="button"
                className="absolute top-1 right-1 p-0.5 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive"
                onClick={(e) => {
                  e.stopPropagation();
                  onUnsign();
                }}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </>
        ) : (
          <span className="text-xs text-muted-foreground">
            {canSign ? "Click to sign" : "Awaiting signature"}
          </span>
        )}
      </div>
      {remarksName && (
        <fieldset
          disabled={currentUserId !== selectedUserId && !canSign}
          className="disabled:opacity-50 disabled:pointer-events-none"
        >
          <FormField
            control={control}
            name={remarksName}
            render={({ field }) => (
              <FormItem>
                <FormLabel>Remarks</FormLabel>
                <FormControl>
                  <Textarea
                    placeholder="Remarks..."
                    className="resize-none"
                    rows={2}
                    {...field}
                  />
                </FormControl>
              </FormItem>
            )}
          />
        </fieldset>
      )}
    </div>
  );
}
