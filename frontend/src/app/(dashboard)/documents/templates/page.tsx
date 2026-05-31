"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Upload, FileText, Trash2 } from "lucide-react";
import api from "@/lib/api";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Tabs } from "@/components/ui/tabs";
import { useSelectedProject } from "@/hooks/use-project";
import { useCurrentUser } from "@/hooks/use-auth";

const DOC_TYPES = ["WIR", "MIR", "CIR", "FAT"] as const;

export default function TemplatesPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const project = useSelectedProject();
  const { data: currentUser, isLoading: userLoading } = useCurrentUser();
  const isAdmin = currentUser?.is_superuser || currentUser?.roles?.some((r: any) => r.name === "admin" || r.name === "super_admin");
  const projectId = project?.id;
  const [name, setName] = useState<Record<string, string>>({});
  const [file, setFile] = useState<Record<string, File | null>>({});
  const [uploading, setUploading] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<any>(null);

  useEffect(() => {
    if (!userLoading && currentUser && !isAdmin) router.replace("/dashboard");
  }, [userLoading, currentUser, isAdmin, router]);

  const { data: templates = [] } = useQuery({
    queryKey: ["doc-templates", projectId],
    queryFn: async () => (await api.get(`/reports/templates?project_id=${projectId}`)).data,
    enabled: !!projectId,
  });

  const handleUpload = async (docType: string) => {
    if (!projectId) { toast.error("Select a project first"); return; }
    if (!name[docType]) { toast.error("Enter a template name"); return; }
    if (!file[docType]) { toast.error("Select a DOCX file"); return; }
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file[docType]!);
      await api.post(`/reports/templates/upload?project_id=${projectId}&doc_type=${docType}&name=${encodeURIComponent(name[docType])}`, form);
      toast.success("Template uploaded");
      setFile((prev) => ({ ...prev, [docType]: null }));
      setName((prev) => ({ ...prev, [docType]: "" }));
      qc.invalidateQueries({ queryKey: ["doc-templates", projectId] });
    } catch (e: any) {
      toast.error(e.response?.data?.detail || "Upload failed");
    } finally { setUploading(false); }
  };

  if (userLoading) return <div className="p-6">Loading...</div>;
  if (!isAdmin) return null;

  const renderTab = (docType: string) => {
    const filtered = templates.filter((t: any) => t.doc_type === docType);
    return (
      <div className="space-y-6">
        <Card>
          <CardHeader><CardTitle className="text-base">Upload {docType} Template</CardTitle></CardHeader>
          <CardContent>
            <div className="flex gap-4 flex-wrap items-start">
              <div className="flex-1 min-w-48">
                <label className="text-xs text-muted-foreground mb-1.5 block">Template Name</label>
                <Input value={name[docType] || ""} onChange={(e) => setName((prev) => ({ ...prev, [docType]: e.target.value }))} placeholder={`e.g. ${docType} Template v1`} />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1.5 block">DOCX File</label>
                <input type="file" accept=".docx" onChange={(e) => setFile((prev) => ({ ...prev, [docType]: e.target.files?.[0] || null }))} className="block text-sm text-foreground file:mr-2 file:py-1.5 file:px-3 file:rounded-md file:border file:border-border file:text-sm file:font-medium file:bg-background file:text-foreground hover:file:bg-accent cursor-pointer" />
              </div>
              <div className="pt-5">
                <Button onClick={() => handleUpload(docType)} disabled={uploading || !file[docType] || !name[docType]}>
                  <Upload className="h-4 w-4 mr-2" />{uploading ? "Uploading..." : "Upload"}
                </Button>
              </div>
            </div>
            <p className="text-xs text-muted-foreground mt-2">Accepted format: DOCX</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">{docType} Templates</CardTitle></CardHeader>
          <CardContent>
            {filtered.length === 0 ? (
              <p className="text-sm text-muted-foreground">No {docType} templates uploaded yet.</p>
            ) : (
              <div className="space-y-2">
                {filtered.map((t: any) => (
                  <div key={t.id} className="flex items-center gap-3 p-3 rounded-md border">
                    <FileText className="h-5 w-5 text-blue-500 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-sm truncate">{t.name}</span>
                        <Badge variant="outline" className="text-xs">v{t.version}</Badge>
                        {t.is_active && <Badge className="text-xs bg-green-600">Active</Badge>}
                      </div>
                      <p className="text-xs text-muted-foreground">{t.filename}</p>
                    </div>
                    <Button variant="ghost" size="sm" onClick={async () => {
                      try {
                        const res = await api.get(`/reports/templates/${t.id}/download`, { responseType: 'blob' });
                        const url = URL.createObjectURL(res.data);
                        const a = document.createElement('a');
                        a.href = url;
                        a.download = t.filename || `${t.name}.docx`;
                        a.click();
                        URL.revokeObjectURL(url);
                      } catch { toast.error("Download failed"); }
                    }}>
                      Download
                    </Button>
                    <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={() => setDeleteTarget(t)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Document Templates</h1>
        <p className="text-sm text-muted-foreground">Upload and manage Word DOCX templates for report generation</p>
      </div>

      <Tabs tabs={DOC_TYPES.map(dt => ({ id: dt, label: dt, content: renderTab(dt) }))} />

      <Dialog open={!!deleteTarget} onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Confirm Deletion</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">Are you sure you want to delete this template? This action cannot be undone.</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>Cancel</Button>
            <Button variant="destructive" onClick={async () => {
              try {
                await api.delete(`/reports/templates/${deleteTarget.id}`);
                toast.success("Template deleted");
                qc.invalidateQueries({ queryKey: ["doc-templates", projectId] });
              } catch { toast.error("Delete failed"); }
              setDeleteTarget(null);
            }}>Delete</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
