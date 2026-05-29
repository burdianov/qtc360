import { format } from "date-fns";

// Map user-facing format tokens to date-fns tokens
const FORMAT_MAP: Record<string, string> = {
  "DD.MM.YYYY": "dd.MM.yyyy",
  "MM/DD/YYYY": "MM/dd/yyyy",
  "YYYY-MM-DD": "yyyy-MM-dd",
  "DD-MM-YYYY": "dd-MM-yyyy",
  "DD/MM/YYYY": "dd/MM/yyyy",
};

let _cachedFormat: string | null = null;

export function setDateFormat(fmt: string) {
  _cachedFormat = fmt;
}

export function getDateFnsFormat(): string {
  return FORMAT_MAP[_cachedFormat || "DD.MM.YYYY"] || "dd.MM.yyyy";
}

/** Format a date string using the configured app date format */
export function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value.length === 10 ? value + "T00:00:00" : value);
  return format(date, getDateFnsFormat());
}
