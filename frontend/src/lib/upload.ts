import { toast } from "sonner";

/** Return "50MB" / "5MB" etc. for a given byte cap. */
export function formatSizeCap(maxBytes: number): string {
  return `${Math.round(maxBytes / 1024 / 1024)}MB`;
}

/**
 * Validate a single file's size. Returns true if it fits, false (and toasts)
 * otherwise. Use BEFORE constructing FormData so we never even start a
 * request for an oversized file.
 */
export function validateFileSize(
  file: File,
  maxBytes: number,
  label = "File",
): boolean {
  if (file.size > maxBytes) {
    toast.error(
      `${label} is too large (${formatSizeCap(maxBytes)} max). "${file.name}" is ${(file.size / 1024 / 1024).toFixed(1)}MB.`,
    );
    return false;
  }
  return true;
}

/**
 * Filter an array of files, dropping (and toasting) any that exceed the cap.
 * Returns the survivors — safe to wrap in FormData and submit.
 */
export function filterBySize(
  files: File[],
  maxBytes: number,
  label = "File",
): File[] {
  const survivors: File[] = [];
  for (const f of files) {
    if (f.size > maxBytes) {
      toast.error(
        `${label} "${f.name}" is too large (${formatSizeCap(maxBytes)} max).`,
      );
    } else {
      survivors.push(f);
    }
  }
  return survivors;
}
