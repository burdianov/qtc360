"use client";

import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import {
  FileText,
  CheckCircle2,
  Clock,
  XCircle,
  Target,
  TrendingUp,
} from "lucide-react";
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer, PieChart, Pie, Cell,
  ComposedChart, Area,
} from "recharts";
import api from "@/lib/api";
import { useSelectedProject } from "@/hooks/use-project";
import { Skeleton } from "@/components/ui/skeleton";

interface Analytics {
  kpi: {
    total_documents: number;
    approved_documents: number;
    pending_approval: number;
    rejected: number;
    total_requirements: number;
    achieved_requirements: number;
    completion_percent: number;
  };
  submission_timeline: { month: string; WIR: number; MIR: number; CIR: number; FAT: number; total: number; approved: number }[];
  doc_status_distribution: { status: string; count: number }[];
  progress_by_pod: { pod: string; total: number; achieved: number; percent: number }[];
  tag_achievement: { tag: string; achieved?: number; in_progress?: number; delayed?: number; not_started?: number }[];
  approval_turnaround: { doc_type: string; avg_days: number; max_days: number; rounds: number }[];
  delayed_items: { tag_number: string; asset_name: string; tag_code: string; target_date: string; status: string }[];
  docs_by_discipline: { name: string; code: string; count: number }[];
}

const STATUS_COLORS: Record<string, string> = {
  approved: "#10b981",
  approved_with_comments: "#34d399",
  with_approver_1: "#f59e0b",
  with_approver_2: "#d97706",
  internally_signed: "#8b5cf6",
  draft: "#6b7280",
  rejected: "#ef4444",
  approver_1_returned: "#06b6d4",
};

const TAG_COLORS: Record<string, string> = {
  red: "#ef4444",
  yellow: "#eab308",
  green: "#22c55e",
  blue: "#3b82f6",
};

const POD_COLORS = ["#3b82f6", "#8b5cf6", "#f59e0b", "#10b981"];

export default function DashboardPage() {
  const project = useSelectedProject();

  const { data, isLoading } = useQuery<Analytics>({
    queryKey: ["dashboard", "analytics", project?.id],
    queryFn: async () =>
      (await api.get("/dashboard/analytics", { params: { project_id: project!.id } })).data,
    enabled: !!project,
  });

  if (!project) return null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
        <p className="text-sm text-muted-foreground">
          Commissioning overview for {project.name}
        </p>
      </div>

      {/* KPI Cards */}
      {isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="rounded-xl border bg-card p-5">
              <Skeleton className="h-4 w-24 mb-3" />
              <Skeleton className="h-8 w-16" />
            </div>
          ))}
        </div>
      ) : data ? (
        <>
          <KPICards kpi={data.kpi} />

          {/* Weekly Targets */}
          <WeeklyTargets />

          {/* Row 2: Submission Timeline + Status Distribution */}
          <div className="grid gap-4 lg:grid-cols-3">
            <div className="lg:col-span-2 rounded-xl border bg-card p-5">
              <div className="flex items-center justify-between mb-1">
                <h3 className="text-sm font-medium">Document Submissions</h3>
                <a href="/documents" className="text-[11px] text-muted-foreground hover:text-foreground transition-colors">View all</a>
              </div>
              <p className="text-xs text-muted-foreground mb-4">Monthly submissions by type with approval trend</p>
              <SubmissionTimeline data={data.submission_timeline} />
            </div>
            <div className="rounded-xl border bg-card p-5">
              <h3 className="text-sm font-medium mb-1">Status Distribution</h3>
              <p className="text-xs text-muted-foreground mb-4">Current document statuses</p>
              <StatusDonut data={data.doc_status_distribution} />
            </div>
          </div>

          {/* Row 3: Progress by POD + Tag Achievement */}
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="rounded-xl border bg-card p-5">
              <div className="flex items-center justify-between mb-1">
                <h3 className="text-sm font-medium">Commissioning Progress by POD</h3>
                <a href="/commissioning/tracking" className="text-[11px] text-muted-foreground hover:text-foreground transition-colors">View all</a>
              </div>
              <p className="text-xs text-muted-foreground mb-4">Requirement completion per POD</p>
              <ProgressByPod data={data.progress_by_pod} />
            </div>
            <div className="rounded-xl border bg-card p-5">
              <div className="flex items-center justify-between mb-1">
                <h3 className="text-sm font-medium">Tag Achievement</h3>
                <a href="/commissioning/tag-targets" className="text-[11px] text-muted-foreground hover:text-foreground transition-colors">View all</a>
              </div>
              <p className="text-xs text-muted-foreground mb-4">Asset tag status across all PODs</p>
              <TagAchievement data={data.tag_achievement} />
            </div>
          </div>

          {/* Row 4: Turnaround + Delayed items */}
          <div className="grid gap-4 lg:grid-cols-3">
            <div className="rounded-xl border bg-card p-5">
              <h3 className="text-sm font-medium mb-1">Approval Turnaround</h3>
              <p className="text-xs text-muted-foreground mb-4">Average days to receive response</p>
              <TurnaroundChart data={data.approval_turnaround} />
            </div>
            <div className="lg:col-span-2 rounded-xl border bg-card p-5">
              <div className="flex items-center justify-between mb-1">
                <h3 className="text-sm font-medium">Delayed Items</h3>
                <a href="/commissioning/tag-targets" className="text-[11px] text-muted-foreground hover:text-foreground transition-colors">View all</a>
              </div>
              <p className="text-xs text-muted-foreground mb-4">Assets past their target commissioning date</p>
              <DelayedTable data={data.delayed_items} />
            </div>
          </div>

          {/* Row 5: Export Reports */}
          <TrackerExport />
        </>
      ) : null}
    </div>
  );
}

function KPICards({ kpi }: { kpi: Analytics["kpi"] }) {
  const router = useRouter();
  const cards = [
    { label: "Total Documents", value: kpi.total_documents, icon: FileText, color: "text-blue-500", bg: "bg-blue-500/10", href: "/documents" },
    { label: "Approved", value: kpi.approved_documents, icon: CheckCircle2, color: "text-emerald-500", bg: "bg-emerald-500/10", href: "/documents?status=approved" },
    { label: "Pending Approval", value: kpi.pending_approval, icon: Clock, color: "text-amber-500", bg: "bg-amber-500/10", href: "/documents?status=with_approver_1" },
    { label: "Commissioning", value: `${kpi.completion_percent}%`, icon: Target, color: "text-purple-500", bg: "bg-purple-500/10", sub: `${kpi.achieved_requirements} of ${kpi.total_requirements} requirements`, href: "/commissioning/requirements" },
  ];

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {cards.map(({ label, value, icon: Icon, color, bg, sub, href }) => (
        <div key={label} onClick={() => router.push(href)}
          className="rounded-xl border bg-card p-5 flex flex-col justify-between cursor-pointer hover:border-primary/50 transition-colors">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-medium text-muted-foreground">{label}</span>
            <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${bg}`}>
              <Icon className={`h-4 w-4 ${color}`} />
            </div>
          </div>
          <p className="text-2xl font-bold">{value}</p>
          {sub && <p className="text-[11px] text-muted-foreground mt-1">{sub}</p>}
        </div>
      ))}
    </div>
  );
}

function SubmissionTimeline({ data }: { data: Analytics["submission_timeline"] }) {
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const formatted = data.map((d) => {
    const [year, month] = d.month.split("-");
    return { ...d, month: `${MONTHS[parseInt(month) - 1]}-${year.slice(2)}` };
  });

  return (
    <ResponsiveContainer width="100%" height={280}>
      <ComposedChart data={formatted} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" opacity={0.5} />
        <XAxis dataKey="month" tick={{ fontSize: 11 }} stroke="var(--muted-foreground)" />
        <YAxis tick={{ fontSize: 11 }} stroke="var(--muted-foreground)" />
        <Tooltip
          contentStyle={{ backgroundColor: "var(--card)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 }}
          labelStyle={{ color: "var(--foreground)" }}
        />
        <Legend wrapperStyle={{ fontSize: 11 }} />
        <Bar dataKey="WIR" stackId="a" fill="#3b82f6" radius={[0, 0, 0, 0]} />
        <Bar dataKey="MIR" stackId="a" fill="#8b5cf6" />
        <Bar dataKey="CIR" stackId="a" fill="#f59e0b" />
        <Bar dataKey="FAT" stackId="a" fill="#10b981" radius={[4, 4, 0, 0]} />
        <Line type="monotone" dataKey="approved" stroke="#ef4444" strokeWidth={2} dot={{ r: 3 }} name="Approved" />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

function StatusDonut({ data }: { data: Analytics["doc_status_distribution"] }) {
  const router = useRouter();
  const total = data.reduce((s, d) => s + d.count, 0);
  const labels: Record<string, string> = {
    approved: "Approved",
    approved_with_comments: "Approved (B)",
    with_approver_1: "With Approver 1",
    with_approver_2: "With Approver 2",
    internally_signed: "Internally Signed",
    draft: "Draft",
    rejected: "Rejected",
    approver_1_returned: "Approver 1 Returned",
  };

  return (
    <div className="flex flex-col items-center">
      <ResponsiveContainer width="100%" height={200}>
        <PieChart>
          <Pie data={data} dataKey="count" nameKey="status" cx="50%" cy="50%"
            innerRadius={55} outerRadius={80} paddingAngle={2}
            onClick={(_, idx) => router.push(`/documents?status=${data[idx].status}`)}
            className="cursor-pointer">
            {data.map((d, i) => (
              <Cell key={i} fill={STATUS_COLORS[d.status] || "#6b7280"} />
            ))}
          </Pie>
          <Tooltip formatter={(v: number, name: string) => [v, labels[name] || name]}
            contentStyle={{ backgroundColor: "var(--card)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12, color: "var(--foreground)" }}
            itemStyle={{ color: "var(--foreground)" }} />
        </PieChart>
      </ResponsiveContainer>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1 mt-2 w-full">
        {data.slice(0, 6).map((d) => (
          <div key={d.status} className="flex items-center gap-1.5 text-[11px] cursor-pointer hover:opacity-70 transition-opacity"
            onClick={() => router.push(`/documents?status=${d.status}`)}>
            <div className="h-2 w-2 rounded-full" style={{ backgroundColor: STATUS_COLORS[d.status] || "#6b7280" }} />
            <span className="text-muted-foreground truncate">{labels[d.status] || d.status}</span>
            <span className="ml-auto font-medium">{d.count}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function ProgressByPod({ data }: { data: Analytics["progress_by_pod"] }) {
  const router = useRouter();
  return (
    <div className="space-y-5">
      {data.map((pod, i) => (
        <div key={pod.pod} className="space-y-1.5 cursor-pointer hover:opacity-80 transition-opacity"
          onClick={() => router.push(`/commissioning/tracking?pod=${pod.pod}`)}>
          <div className="flex justify-between text-sm">
            <span className="font-medium">{pod.pod}</span>
            <span className="text-muted-foreground text-xs">{pod.achieved}/{pod.total} ({pod.percent}%)</span>
          </div>
          <div className="h-3 rounded-full bg-muted overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{ width: `${pod.percent}%`, backgroundColor: POD_COLORS[i % POD_COLORS.length] }}
            />
          </div>
        </div>
      ))}
      <div className="pt-2 border-t">
        <div className="flex justify-between text-sm">
          <span className="font-medium">Overall</span>
          <span className="text-muted-foreground text-xs">
            {data.reduce((s, d) => s + d.achieved, 0)}/{data.reduce((s, d) => s + d.total, 0)}
            {" "}({data.length > 0 ? Math.round(data.reduce((s, d) => s + d.achieved, 0) / data.reduce((s, d) => s + d.total, 0) * 100) : 0}%)
          </span>
        </div>
        <div className="h-3 rounded-full bg-muted overflow-hidden mt-1.5">
          <div
            className="h-full rounded-full bg-foreground/80 transition-all duration-500"
            style={{ width: `${data.length > 0 ? Math.round(data.reduce((s, d) => s + d.achieved, 0) / data.reduce((s, d) => s + d.total, 0) * 100) : 0}%` }}
          />
        </div>
      </div>
    </div>
  );
}

function TagAchievement({ data }: { data: Analytics["tag_achievement"] }) {
  const router = useRouter();
  const order = ["red", "yellow", "green", "blue"];
  const labels: Record<string, string> = { red: "Red Tag", yellow: "Yellow Tag", green: "Green Tag", blue: "Blue Tag" };
  const sorted = order.map((t) => data.find((d) => d.tag === t)).filter(Boolean) as Analytics["tag_achievement"];

  return (
    <div className="space-y-4">
      {sorted.map((tag) => {
        const achieved = tag.achieved || 0;
        const inProgress = tag.in_progress || 0;
        const delayed = tag.delayed || 0;
        const notStarted = tag.not_started || 0;
        const total = achieved + inProgress + delayed + notStarted;
        return (
          <div key={tag.tag} className="space-y-1.5 cursor-pointer hover:opacity-80 transition-opacity"
          onClick={() => router.push(`/commissioning/tag-targets?tag=${tag.tag}`)}>
            <div className="flex items-center justify-between text-sm">
              <div className="flex items-center gap-2">
                <div className="h-3 w-3 rounded-full" style={{ backgroundColor: TAG_COLORS[tag.tag] }} />
                <span className="font-medium">{labels[tag.tag]}</span>
              </div>
              <span className="text-xs text-muted-foreground">{achieved}/{total} achieved</span>
            </div>
            {/* Stacked bar */}
            <div className="h-2.5 rounded-full bg-muted overflow-hidden flex">
              {achieved > 0 && <div className="h-full" style={{ width: `${achieved / total * 100}%`, backgroundColor: TAG_COLORS[tag.tag] }} />}
              {inProgress > 0 && <div className="h-full" style={{ width: `${inProgress / total * 100}%`, backgroundColor: TAG_COLORS[tag.tag], opacity: 0.4 }} />}
              {delayed > 0 && <div className="h-full bg-red-500/60" style={{ width: `${delayed / total * 100}%` }} />}
            </div>
            <div className="flex gap-3 text-[10px] text-muted-foreground">
              {delayed > 0 && <span className="text-red-500">{delayed} delayed</span>}
              {inProgress > 0 && <span>{inProgress} in progress</span>}
              {notStarted > 0 && <span>{notStarted} not started</span>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function TurnaroundChart({ data }: { data: Analytics["approval_turnaround"] }) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={data} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" opacity={0.5} />
        <XAxis dataKey="doc_type" tick={{ fontSize: 11 }} stroke="var(--muted-foreground)" />
        <YAxis tick={{ fontSize: 11 }} stroke="var(--muted-foreground)" label={{ value: "Days", angle: -90, position: "insideLeft", style: { fontSize: 10 } }} />
        <Tooltip
          contentStyle={{ backgroundColor: "var(--card)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12, color: "var(--foreground)" }}
          itemStyle={{ color: "var(--foreground)" }}
        />
        <Bar dataKey="avg_days" fill="#3b82f6" radius={[4, 4, 0, 0]} name="Average" />
        <Bar dataKey="max_days" fill="#3b82f6" opacity={0.3} radius={[4, 4, 0, 0]} name="Max" />
      </BarChart>
    </ResponsiveContainer>
  );
}

function DelayedTable({ data }: { data: Analytics["delayed_items"] }) {
  const router = useRouter();
  if (data.length === 0) {
    return <p className="text-sm text-muted-foreground py-8 text-center">No delayed items</p>;
  }

  return (
    <div className="overflow-auto max-h-[280px]">
      <table className="w-full text-sm">
        <thead className="sticky top-0 bg-card">
          <tr className="border-b text-xs text-muted-foreground">
            <th className="text-left py-2 font-medium">Asset</th>
            <th className="text-left py-2 font-medium">Tag</th>
            <th className="text-left py-2 font-medium">Target Date</th>
            <th className="text-left py-2 font-medium">Status</th>
          </tr>
        </thead>
        <tbody>
          {data.map((item, i) => (
            <tr key={i} className="border-b border-border/50 last:border-0 cursor-pointer hover:bg-muted/50 transition-colors"
              onClick={() => router.push(`/commissioning/tag-targets?tag=${item.tag_code}`)}>
              <td className="py-2">
                <div className="font-medium text-xs">{item.tag_number}</div>
                <div className="text-[11px] text-muted-foreground">{item.asset_name}</div>
              </td>
              <td className="py-2">
                <span className="inline-flex items-center gap-1">
                  <span className="h-2 w-2 rounded-full" style={{ backgroundColor: TAG_COLORS[item.tag_code] }} />
                  <span className="text-xs capitalize">{item.tag_code}</span>
                </span>
              </td>
              <td className="py-2 text-xs text-muted-foreground">{item.target_date}</td>
              <td className="py-2">
                <span className="text-xs px-1.5 py-0.5 rounded bg-red-500/10 text-red-500 font-medium">
                  {item.status.replace("_", " ")}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}


interface WeeklyItem {
  week: string;
  red: number;
  yellow: number;
  green: number;
  blue: number;
}

function WeeklyTargets() {
  const project = useSelectedProject();
  const router = useRouter();

  const { data } = useQuery<WeeklyItem[]>({
    queryKey: ["dashboard", "weekly-targets", project?.id],
    queryFn: async () =>
      (await api.get("/dashboard/weekly-targets", { params: { project_id: project!.id } })).data,
    enabled: !!project,
  });

  if (!data || data.length === 0) return null;

  const handleBarClick = (tag: string, entry: WeeklyItem) => {
    if (entry.week === "Overdue") {
      router.push(`/commissioning/tag-targets?tag=${tag}&status=delayed`);
    } else {
      // Extract dates from "30 May - 05 Jun" format
      router.push(`/commissioning/tag-targets?tag=${tag}&week=${encodeURIComponent(entry.week)}`);
    }
  };

  return (
    <div className="rounded-xl border bg-card p-5">
      <h3 className="text-sm font-medium mb-1">Upcoming Tag Targets</h3>
      <p className="text-xs text-muted-foreground mb-4">Number of tags to achieve per week - click a bar for details</p>
      <ResponsiveContainer width="100%" height={240}>
        <BarChart data={data} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" opacity={0.5} />
          <XAxis dataKey="week" tick={{ fontSize: 10 }} stroke="var(--muted-foreground)" interval={0} />
          <YAxis tick={{ fontSize: 11 }} stroke="var(--muted-foreground)" allowDecimals={false} />
          <Tooltip
            contentStyle={{ backgroundColor: "var(--card)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 }}
            labelStyle={{ color: "var(--foreground)", fontWeight: 600, marginBottom: 4 }}
            labelFormatter={(label) => label === "Overdue" ? "⚠ OVERDUE" : `Target: ${label}`}
            formatter={(value: number, name: string) => [`${value} tags`, name]}
            itemStyle={{ paddingTop: 2 }}
            cursor={{ fill: "var(--muted)", opacity: 0.3 }}
          />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          <Bar dataKey="red" name="Red Tag" fill="#ef4444" radius={[3, 3, 0, 0]} className="cursor-pointer" onClick={(_, idx) => handleBarClick("red", data[idx])} />
          <Bar dataKey="yellow" name="Yellow Tag" fill="#eab308" radius={[3, 3, 0, 0]} className="cursor-pointer" onClick={(_, idx) => handleBarClick("yellow", data[idx])} />
          <Bar dataKey="green" name="Green Tag" fill="#22c55e" radius={[3, 3, 0, 0]} className="cursor-pointer" onClick={(_, idx) => handleBarClick("green", data[idx])} />
          <Bar dataKey="blue" name="Blue Tag" fill="#3b82f6" radius={[3, 3, 0, 0]} className="cursor-pointer" onClick={(_, idx) => handleBarClick("blue", data[idx])} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function TrackerExport() {
  const project = useSelectedProject();
  const router = useRouter();

  const handleExport = async (type: "tracker" | "remarks") => {
    if (!project) return;
    try {
      const { data } = await api.get("/dashboard/tracker-export", { params: { project_id: project.id } });
      if (!data || data.length === 0) return;

      let csv: string;
      if (type === "tracker") {
        const headers = ["Asset Tag", "Asset Name", "POD", "Location", "Requirement", "Code", "Level", "Doc Type", "Req Status", "Doc Reference", "Doc Status", "Approver 1", "Decision 1", "Aconex Sent 1", "Aconex Received 1", "Approver 1 Remarks", "Response Date 1", "Approver 2", "Decision 2", "Aconex Sent 2", "Aconex Received 2", "Approver 2 Remarks", "Response Date 2"];
        const rows = data.map((r: any) => [r.asset_tag, r.asset_name, r.pod, r.location, r.requirement, r.req_code, r.level, r.doc_type, r.req_status, r.doc_reference, r.doc_status, r.approver_1_signatory, r.approver_1_decision, r.approver_1_aconex_sent, r.approver_1_aconex_received, r.approver_1_remarks, r.approver_1_date, r.approver_2_signatory, r.approver_2_decision, r.approver_2_aconex_sent, r.approver_2_aconex_received, r.approver_2_remarks, r.approver_2_date]);
        csv = [headers, ...rows].map((r) => r.map((c: string) => `"${(c || "").replace(/"/g, '""')}"`).join(",")).join("\n");
      } else {
        const withRemarks = data.filter((r: any) => r.approver_1_remarks || r.approver_2_remarks);
        const headers = ["Asset Tag", "Requirement", "Doc Reference", "Approver 1", "Decision", "Aconex Sent", "Aconex Received", "Remarks", "Date", "Approver 2", "Decision", "Aconex Sent", "Aconex Received", "Remarks", "Date"];
        const rows = withRemarks.map((r: any) => [r.asset_tag, r.requirement, r.doc_reference, r.approver_1_signatory, r.approver_1_decision, r.approver_1_aconex_sent, r.approver_1_aconex_received, r.approver_1_remarks, r.approver_1_date, r.approver_2_signatory, r.approver_2_decision, r.approver_2_aconex_sent, r.approver_2_aconex_received, r.approver_2_remarks, r.approver_2_date]);
        csv = [headers, ...rows].map((r) => r.map((c: string) => `"${(c || "").replace(/"/g, '""')}"`).join(",")).join("\n");
      }

      const blob = new Blob([csv], { type: "text/csv" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = type === "tracker" ? `commissioning-tracker-${project.name}.csv` : `approver-remarks-${project.name}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch { /* ignore */ }
  };

  return (
    <div className="rounded-xl border bg-card p-5">
      <h3 className="text-sm font-medium mb-1">Reports & Exports</h3>
      <p className="text-xs text-muted-foreground mb-4">Download commissioning data for offline use or reporting</p>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <button onClick={() => handleExport("tracker")}
          className="flex items-center gap-3 p-4 rounded-lg border hover:border-primary/50 transition-colors text-left">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-500/10">
            <FileText className="h-5 w-5 text-blue-500" />
          </div>
          <div>
            <p className="text-sm font-medium">Commissioning Tracker</p>
            <p className="text-[11px] text-muted-foreground">Full tracker with all levels, statuses, and approvals</p>
          </div>
        </button>
        <button onClick={() => handleExport("remarks")}
          className="flex items-center gap-3 p-4 rounded-lg border hover:border-primary/50 transition-colors text-left">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-500/10">
            <Clock className="h-5 w-5 text-amber-500" />
          </div>
          <div>
            <p className="text-sm font-medium">Approver Remarks</p>
            <p className="text-[11px] text-muted-foreground">All approver comments and decisions per document</p>
          </div>
        </button>
        <button onClick={() => router.push("/commissioning/tracking")}
          className="flex items-center gap-3 p-4 rounded-lg border hover:border-primary/50 transition-colors text-left">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-500/10">
            <Target className="h-5 w-5 text-emerald-500" />
          </div>
          <div>
            <p className="text-sm font-medium">Live Tracking</p>
            <p className="text-[11px] text-muted-foreground">Real-time commissioning progress with tag status</p>
          </div>
        </button>
      </div>
    </div>
  );
}
