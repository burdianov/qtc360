import { format } from "date-fns";

/** Format a date string as dd-MMM-yy (e.g. 27-May-26) */
export function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value.length === 10 ? value + "T00:00:00" : value);
  return format(date, "dd-MMM-yy");
}
