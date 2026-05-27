"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Upload, FileText, Trash2 } from "lucide-react";
import api from "@/lib/api";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useSelectedProject } from "@/hooks/use-project";

export default function TemplatesPage() {
  const qc = useQueryClient();
  const project = useSelectedProject();
  const projectId = project?.id;
  const [docType, setDocType] = useState("WIR");
  const [name, setName] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<any>(null);

  const { data: templates = [] } = useQuery({
    queryKey: ["doc-templates", projectId],
    queryFn: async () => (await api.get(`/reports/templates?project_id=${projectId}`)).data,
    enabled: !!projectId,
  });

  const handleUpload = async () => {
    if (!projectId) { toast.error("Select a project first"); return; }
    if (!name) { toast.error("Enter a template name"); return; }
    if (!file) { toast.error("Select a DOCX file"); return; }
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      await api.post(`/reports/templates/upload?project_id=${projectId}&doc_type=${docType}&name=${encodeURIComponent(name)}`, form, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      toast.success("Template uploaded");
      setFile(null);
      setName("");
      qc.invalidateQueries({ queryKey: ["doc-templates", projectId] });
    } catch (e: any) {
      toast.error(e.response?.data?.detail || "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Document Templates</h1>
        <p className="text-sm text-muted-foreground">Upload and manage Word DOCX templates for report generation</p>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Upload Template</CardTitle></CardHeader>
        <CardContent>
          <div className="flex gap-4 flex-wrap items-end">
            <div>
              <label className="text-xs text-muted-foreground mb-1.5 block">Doc Type</label>
              <Select value={docType} onValueChange={setDocType}>
                <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="WIR">WIR</SelectItem>
                  <SelectItem value="MIR">MIR</SelectItem>
                  <SelectItem value="CIR">CIR</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex-1 min-w-48">
              <label className="text-xs text-muted-foreground mb-1.5 block">Template Name</label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. WIR Template v1" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1.5 block">DOCX File</label>
              <input type="file" accept=".docx" onChange={(e) => setFile(e.target.files?.[0] || null)} className="block text-sm text-foreground file:mr-2 file:py-1.5 file:px-3 file:rounded-md file:border file:border-border file:text-sm file:font-medium file:bg-background file:text-foreground hover:file:bg-accent cursor-pointer" />
            </div>
            <Button onClick={handleUpload} disabled={uploading || !file || !name}>
              <Upload className="h-4 w-4 mr-2" />{uploading ? "Uploading..." : "Upload"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Templates</CardTitle></CardHeader>
        <CardContent>
          {templates.length === 0 ? (
            <p className="text-sm text-muted-foreground">No templates uploaded yet.</p>
          ) : (
            <div className="space-y-2">
              {templates.map((t: any) => (
                <div key={t.id} className="flex items-center gap-3 p-3 rounded-md border">
                  <FileText className="h-5 w-5 text-blue-500 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm truncate">{t.name}</span>
                      <Badge variant="outline" className="text-xs">{t.doc_type}</Badge>
                      <Badge variant="outline" className="text-xs">v{t.version}</Badge>
                      {t.is_active && <Badge className="text-xs bg-green-600">Active</Badge>}
                    </div>
                    <p className="text-xs text-muted-foreground">{t.filename}</p>
                  </div>
                  <Button variant="ghost" size="sm" onClick={() => window.open(`${api.defaults.baseURL}/reports/templates/${t.id}/download`)}>
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

      <Dialog open={!!deleteTarget} onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm Deletion</DialogTitle>
          </DialogHeader>
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
