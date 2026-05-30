// ─── Document Statuses ──────────────────────────────────────────────────────
export const DOC_STATUS = {
  DRAFT: "draft",
  INTERNALLY_SIGNED: "internally_signed",
  WITH_APPROVER_1: "with_approver_1",
  APPROVER_1_RETURNED: "approver_1_returned",
  WITH_APPROVER_2: "with_approver_2",
  APPROVED: "approved",
  APPROVED_WITH_COMMENTS: "approved_with_comments",
  REJECTED: "rejected",
  SUPERSEDED: "superseded",
} as const;

// ─── Status Colors (Badge styling) ─────────────────────────────────────────
export const statusColors: Record<string, string> = {
  draft: "bg-muted text-muted-foreground",
  internally_signed: "bg-sky-500/15 text-sky-500",
  with_approver_1: "bg-amber-500/15 text-amber-500",
  approver_1_returned: "bg-orange-500/15 text-orange-500",
  with_approver_2: "bg-amber-500/15 text-amber-500",
  submitted: "bg-amber-500/15 text-amber-500",
  approved: "bg-emerald-500/15 text-emerald-500",
  approved_with_comments: "bg-emerald-500/15 text-emerald-500",
  rejected: "bg-red-500/15 text-red-500",
  superseded: "bg-muted text-muted-foreground",
  cancelled: "bg-muted text-muted-foreground",
};

// ─── Tag Colors ─────────────────────────────────────────────────────────────
export const tagColors: Record<string, string> = {
  red: "bg-red-500/15 text-red-500",
  yellow: "bg-yellow-500/15 text-yellow-600",
  green: "bg-emerald-500/15 text-emerald-500",
  blue: "bg-blue-500/15 text-blue-500",
};

// ─── Requirement Statuses ───────────────────────────────────────────────────
export const reqStatusColors: Record<string, string> = {
  not_started: "bg-muted text-muted-foreground",
  in_progress: "bg-amber-500/15 text-amber-500",
  partial: "bg-sky-500/15 text-sky-500",
  achieved: "bg-emerald-500/15 text-emerald-500",
};

// ─── Document Types ─────────────────────────────────────────────────────────
export const DOCUMENT_TYPES = ["WIR", "MIR", "CIR", "FAT"] as const;

// ─── Storage Keys ───────────────────────────────────────────────────────────
export const STORAGE_KEYS = {
  ACCESS_TOKEN: "access_token",
  REFRESH_TOKEN: "refresh_token",
  SELECTED_PROJECT: "selected_project",
  SIDEBAR_STATE: "sidebar_state",
} as const;

// ─── Pagination ─────────────────────────────────────────────────────────────
export const PAGE_SIZE_OPTIONS = [10, 20, 30, 50, 100] as const;
