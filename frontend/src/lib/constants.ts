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
  approved: "bg-emerald-500/15 text-emerald-500",
  approved_with_comments: "bg-emerald-500/15 text-emerald-500",
  rejected: "bg-red-500/15 text-red-500",
  superseded: "bg-muted text-muted-foreground",
};

// ─── Tag Colors ─────────────────────────────────────────────────────────────
export const tagColors: Record<string, string> = {
  red: "bg-red-500/15 text-red-500",
  yellow: "bg-yellow-500/15 text-yellow-600",
  green: "bg-emerald-500/15 text-emerald-500",
  blue: "bg-blue-500/15 text-blue-500",
};

// ─── Level Colors (commissioning levels → tag color mapping) ────────────────
export const levelColors: Record<string, string> = {
  L1: "bg-red-100 dark:bg-red-900",
  L2A: "bg-red-100 dark:bg-red-900",
  L2B: "bg-yellow-100 dark:bg-yellow-900",
  L3: "bg-emerald-100 dark:bg-emerald-900",
  L4: "bg-blue-100 dark:bg-blue-900",
};

// ─── Requirement Statuses ───────────────────────────────────────────────────
export const reqStatusColors: Record<string, string> = {
  not_started: "bg-muted text-muted-foreground",
  in_progress: "bg-amber-500/15 text-amber-500",
  partial: "bg-sky-500/15 text-sky-500",
  achieved: "bg-emerald-500/15 text-emerald-500",
  not_applicable: "bg-muted text-muted-foreground",
};

// ─── Document Types ─────────────────────────────────────────────────────────
export const DOCUMENT_TYPES = ["WIR", "MIR", "CIR", "FAT", "CRS", "CHECKLIST"] as const;

// ─── Storage Keys ───────────────────────────────────────────────────────────
export const STORAGE_KEYS = {
  ACCESS_TOKEN: "access_token",
  REFRESH_TOKEN: "refresh_token",
  SELECTED_PROJECT: "selected_project",
  SIDEBAR_STATE: "sidebar_state",
} as const;

// ─── Pagination ─────────────────────────────────────────────────────────────
export const PAGE_SIZE_OPTIONS = [10, 20, 30, 50, 100] as const;

// ─── Upload Limits ──────────────────────────────────────────────────────────
// Mirrors backend/app/core/types.py. Keep these in sync.
export const MAX_ATTACHMENT_BYTES = 50 * 1024 * 1024; // 50 MB per file
export const MAX_BUNDLE_BYTES = 50 * 1024 * 1024; // 50 MB total bundle cap
export const MAX_HEADER_IMAGE_BYTES = 5 * 1024 * 1024; // 5 MB CRS header image
