import {
  LayoutDashboard,
  Bell,
  Users,
  FolderKanban,
  Compass,
  Wrench,
  ListChecks,
  Box,
  Network,
  Building2,
  UserCheck,
  FileText,
  ClipboardCheck,
  HardHat,
  FileSearch,
  Layers,
  Gauge,
  FileUp,
  FileStack,
  Shield,
  Lock,
  Settings,
  type LucideIcon,
} from "lucide-react";

export type NavItem = {
  title: string;
  url: string;
  icon: LucideIcon;
  badge?: string;
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
      { title: "Assets", url: "/master-data/assets", icon: Box },
      { title: "Systems", url: "/master-data/systems", icon: Network },
      { title: "Contractors", url: "/master-data/contractors", icon: Building2 },
      { title: "Client", url: "/master-data/clients", icon: UserCheck },
      { title: "Approvers", url: "/master-data/approvers", icon: ClipboardCheck },
    ],
  },
  {
    label: "QA/QC",
    items: [
      { title: "Documents", url: "/qaqc/documents", icon: FileStack },
      { title: "MIR", url: "/qaqc/mir", icon: FileText },
      { title: "WIR", url: "/qaqc/wir", icon: HardHat },
      { title: "CIR", url: "/qaqc/cir", icon: FileSearch },
    ],
  },
  {
    label: "Commissioning",
    items: [
      { title: "Requirements", url: "/commissioning/requirements", icon: ListChecks },
      { title: "Tag Targets", url: "/commissioning/tag-targets", icon: Gauge },
      { title: "Tracking", url: "/commissioning/tracking", icon: Layers },
    ],
  },
  {
    label: "Documents",
    items: [
      { title: "Documents", url: "/documents", icon: FileText },
      { title: "Templates", url: "/documents/templates", icon: FileUp },
    ],
  },
  {
    label: "Administration",
    items: [
      { title: "Users", url: "/admin/users", icon: Users },
      { title: "Roles", url: "/admin/roles", icon: Shield },
      { title: "Permissions", url: "/admin/permissions", icon: Lock },
      { title: "Settings", url: "/admin/settings", icon: Settings },
    ],
  },
];
