"use client";

import { Suspense } from "react";
import { CenteredSpinner } from "@/components/loaders/centered-spinner";

interface DocumentFormWrapperProps {
  children: React.ReactNode;
  /** Document type shown in the loading spinner label */
  label?: string;
}

/**
 * Wraps a QA/QC document form page with a Suspense boundary.
 *
 * Required because pages that call {@code useSearchParams()} must be
 * wrapped in a Suspense boundary in Next.js App Router.
 *
 * Use as the default export of a page.tsx:
 * ```tsx
 * export default function NewMIRPage() {
 *   return (
 *     <DocumentFormWrapper label="Loading document…">
 *       <NewMIRPageInner />
 *     </DocumentFormWrapper>
 *   );
 * }
 * ```
 *
 * The "Inner" component (with key-based remount logic for
 * new→edit transitions) remains in each page.tsx — it is only
 * ~20 lines and needs direct access to {@code useSearchParams}.
 */
export function DocumentFormWrapper({
  children,
  label = "Loading document…",
}: DocumentFormWrapperProps) {
  return (
    <Suspense fallback={<CenteredSpinner label={label} />}>
      {children}
    </Suspense>
  );
}
