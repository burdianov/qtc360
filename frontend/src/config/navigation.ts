import {
  LayoutDashboard,
  BarChart3,
  Activity,
  Users,
  FolderKanban,
  Compass,
  Wrench,
  ListChecks,
  ListTree,
  FlaskConical,
  Box,
  Network,
  Building2,
  UserCheck,
  FileText,
  ClipboardCheck,
  HardHat,
  FileSearch,
  Layers,
  ArrowRightLeft,
  Gauge,
  FileUp,
  FileStack,
  Upload,
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
      { title: "Analytics", url: "/analytics", icon: BarChart3 },
      { title: "Activity", url: "/activity", icon: Activity },
    ],
  },
  {
    label: "Master Data",
    items: [
      { title: "Projects", url: "/master-data/projects", icon: FolderKanban },
      { title: "Disciplines", url: "/master-data/disciplines", icon: Compass },
      { title: "Services", url: "/master-data/services", icon: Wrench },
      { title: "Activities", url: "/master-data/activities", icon: ListChecks },
      { title: "Sub-Activities", url: "/master-data/sub-activities", icon: ListTree },
      { title: "Tests", url: "/master-data/tests", icon: FlaskConical },
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
      { title: "FAT Reports", url: "/qaqc/fat-reports", icon: FileStack },
      { title: "MIR", url: "/qaqc/mir", icon: FileText },
      { title: "WIR", url: "/qaqc/wir", icon: HardHat },
      { title: "CIR", url: "/qaqc/cir", icon: FileSearch },
    ],
  },
  {
    label: "Commissioning",
    items: [
      { title: "Systems", url: "/commissioning/systems", icon: Network },
      { title: "Levels", url: "/commissioning/levels", icon: Layers },
      { title: "Handover", url: "/commissioning/handover", icon: ArrowRightLeft },
      { title: "Tracking", url: "/commissioning/tracking", icon: Gauge },
    ],
  },
  {
    label: "Documents",
    items: [
      { title: "Documents", url: "/documents", icon: FileText },
      { title: "Templates", url: "/documents/templates", icon: FileUp },
      { title: "Uploads", url: "/documents/uploads", icon: Upload },
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
