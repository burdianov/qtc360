"use client";

import { Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";

export interface FormSaveActionsProps {
  /** Called when Cancel is clicked */
  onCancel: () => void;
  /** Whether the save mutation is pending */
  isPending: boolean;
  /** Whether to show the Save button (default: true) */
  showSave?: boolean;
  /** Save button label while idle */
  saveLabel?: string;
  /** Save button label while pending */
  savingLabel?: string;
  /** Whether to show the Notify Signatories button */
  showNotify?: boolean;
  /** Called when Notify Signatories is clicked */
  onNotify?: () => void;
  /** Whether the Notify button is disabled */
  notifyDisabled?: boolean;
  /** Whether the notify mutation is pending */
  notifyPending?: boolean;
  /** Notify button label */
  notifyLabel?: string;
}

/**
 * Cancel / Save as Draft / Notify Signatories action bar.
 *
 * Used at the bottom of MIR, CIR, WIR document forms.
 */
export function FormSaveActions({
  onCancel,
  isPending,
  showSave = true,
  saveLabel = "Save as Draft",
  savingLabel = "Saving…",
  showNotify = false,
  onNotify,
  notifyDisabled = false,
  notifyPending = false,
  notifyLabel = "Notify Signatory",
}: FormSaveActionsProps) {
  return (
    <div className="flex justify-end gap-3">
      <Button type="button" variant="outline" onClick={onCancel}>
        Cancel
      </Button>
      {showSave && (
        <Button type="submit" disabled={isPending}>
          {isPending && <Spinner size="sm" className="mr-1 text-current" />}
          {isPending ? savingLabel : saveLabel}
        </Button>
      )}
      {showNotify && (
        <Button
          type="button"
          onClick={() => {
            if (onNotify) onNotify();
          }}
          disabled={notifyDisabled || notifyPending}
          variant="default"
        >
          {notifyPending && <Spinner size="sm" className="mr-1 text-current" />}
          <Send className="h-4 w-4 mr-1" />
          {notifyPending ? "Notifying…" : notifyLabel}
        </Button>
      )}
    </div>
  );
}
