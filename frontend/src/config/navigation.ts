import {
  LayoutDashboard,
  Bell,
  Users,
  FolderKanban,
  Compass,
  Wrench,
  ListChecks,
  Box,
  Boxes,
  Network,
  Building2,
  UserCheck,
  FileText,
  ClipboardCheck,
  HardHat,
  FileSearch,
  MessageSquareReply,
  Layers,
  Gauge,
  FileUp,
  Shield,
  Lock,
  Settings,
  BadgeCheck,
  type LucideIcon,
} from "lucide-react";

export type NavItem = {
  title: string;
  url: string;
  icon: LucideIcon;
  badge?: string;
  adminOnly?: boolean;
};

export type NavGroup = {
  label: string;
  items: NavItem[];
};

export const navigation: NavGroup[] = [
  {
    label: "Overview",
    items: [
      { title: "Dashboard", url: "/dashboard", icon: LayoutDashboard },
      { title: "Notifications", url: "/notifications", icon: Bell },
    ],
  },
  {
    label: "Master Data",
    items: [
      { title: "Projects", url: "/master-data/projects", icon: FolderKanban },
      { title: "Disciplines", url: "/master-data/disciplines", icon: Compass },
      { title: "Services", url: "/master-data/services", icon: Wrench },
      { title: "Requirement Templates", url: "/master-data/requirement-templates", icon: ListChecks },
      { title: "Asset Types", url: "/master-data/asset-types", icon: Boxes },
      { title: "Assets", url: "/master-data/assets", icon: Box },
      { title: "Systems", url: "/master-data/systems", icon: Network },
      { title: "Contractors", url: "/master-data/contractors", icon: Building2 },
      { title: "Client", url: "/master-data/clients", icon: UserCheck },
      { title: "Approvers", url: "/master-data/approvers", icon: ClipboardCheck },
      { title: "Designations", url: "/master-data/designations", icon: BadgeCheck },
    ],
  },
  {
    label: "QA/QC",
    items: [
      { title: "FAT", url: "/qaqc/fat", icon: ClipboardCheck },
      { title: "MIR", url: "/qaqc/mir", icon: FileText },
      { title: "WIR", url: "/qaqc/wir", icon: HardHat },
      { title: "CIR", url: "/qaqc/cir", icon: FileSearch },
      { title: "CRS", url: "/qaqc/crs", icon: MessageSquareReply },
    ],
  },
  {
    label: "Commissioning",
    items: [
      { title: "Matrix", url: "/commissioning/matrix", icon: Layers },
      { title: "Requirements", url: "/commissioning/requirements", icon: ListChecks },
      { title: "Tag Targets", url: "/commissioning/tag-targets", icon: Gauge },
      { title: "Tracking", url: "/commissioning/tracking", icon: Layers },
    ],
  },
  {
    label: "Documents",
    items: [
      { title: "Documents", url: "/documents", icon: FileText },
      { title: "Templates", url: "/documents/templates", icon: FileUp, adminOnly: true },
    ],
  },
  {
    label: "Administration",
    items: [
      { title: "Users", url: "/admin/users", icon: Users },
      { title: "Roles", url: "/admin/roles", icon: Shield },
      { title: "Permissions", url: "/admin/permissions", icon: Lock },
      { title: "Settings", url: "/admin/settings", icon: Settings },
      { title: "Audit Trail", url: "/admin/audit", icon: FileText },
    ],
  },
];
