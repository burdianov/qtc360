export const statusColors: Record<string, string> = {
  draft: "bg-muted text-muted-foreground",
  submitted: "bg-amber-500/15 text-amber-500",
  approved: "bg-emerald-500/15 text-emerald-500",
  approved_with_comments: "bg-emerald-500/15 text-emerald-500",
  rejected: "bg-red-500/15 text-red-500",
  superseded: "bg-muted text-muted-foreground",
  cancelled: "bg-muted text-muted-foreground",
};

export const tagColors: Record<string, string> = {
  red: "bg-red-500/15 text-red-500",
  yellow: "bg-yellow-500/15 text-yellow-600",
  green: "bg-emerald-500/15 text-emerald-500",
  blue: "bg-blue-500/15 text-blue-500",
};
