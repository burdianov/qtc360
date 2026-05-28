"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import api from "@/lib/api";
import { toast } from "sonner";
import { useSelectedProject } from "@/hooks/use-project";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Trash2 } from "lucide-react";
import { ProjectApproversCard } from "./project-approvers-card";

interface RefConfig {
  id: string;
  project_id: string;
  doc_type: string;
  pattern: string;
  project_code: string;
  contractor_code: string;
  serial_start: number;
}

export default function SettingsPage() {
  const qc = useQueryClient();
  const project = useSelectedProject();
  const projectId = project?.id;

  const [docType, setDocType] = useState("WIR");
  const [projectCode, setProjectCode] = useState("");
  const [contractorCode, setContractorCode] = useState("");
  const [pattern, setPattern] = useState("{project_code}-{contractor_code}-{discipline_code}-{doc_type}-{serial:04d}");
  const [serialStart, setSerialStart] = useState(1);

  const { data: configs = [] } = useQuery<RefConfig[]>({
    queryKey: ["ref-configs", projectId],
    queryFn: async () => (await api.get("/ref-config", { params: { project_id: projectId } })).data,
    enabled: !!projectId,
  });

  const saveMutation = useMutation({
    mutationFn: () => api.post("/ref-config", {
      project_id: projectId,
      doc_type: docType,
      pattern,
      project_code: projectCode,
      contractor_code: contractorCode,
      serial_start: serialStart,
    }),
    onSuccess: () => {
      toast.success("Reference number config saved");
      qc.invalidateQueries({ queryKey: ["ref-configs", projectId] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/ref-config/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["ref-configs", projectId] }),
  });

  const existing = configs.find((c) => c.doc_type === docType);
  const loadExisting = () => {
    if (existing) {
      setProjectCode(existing.project_code);
      setContractorCode(existing.contractor_code);
      setPattern(existing.pattern);
      setSerialStart(existing.serial_start);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground">Project configuration</p>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Reference Number Configuration</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Configure how document reference numbers are generated. Example: <code className="text-xs bg-muted px-1 py-0.5 rounded">MERC-JMJV-EL-WIR-0031</code>
          </p>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="text-xs text-muted-foreground mb-1.5 block">Document Type</label>
              <Select value={docType} onValueChange={(v) => { setDocType(v as string); }}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="WIR">WIR</SelectItem>
                  <SelectItem value="MIR">MIR</SelectItem>
                  <SelectItem value="CIR">CIR</SelectItem>
                  <SelectItem value="FAT">FAT</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1.5 block">Project Code (e.g. MERC)</label>
              <Input value={projectCode} onChange={(e) => setProjectCode(e.target.value)} placeholder="MERC" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1.5 block">Contractor Code (e.g. JMJV)</label>
              <Input value={contractorCode} onChange={(e) => setContractorCode(e.target.value)} placeholder="JMJV" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1.5 block">Serial Start</label>
              <Input type="number" value={serialStart} onChange={(e) => setSerialStart(Number(e.target.value))} />
            </div>
            <div className="sm:col-span-2">
              <label className="text-xs text-muted-foreground mb-1.5 block">Pattern</label>
              <Input value={pattern} onChange={(e) => setPattern(e.target.value)} placeholder="{project_code}-{contractor_code}-{discipline_code}-{doc_type}-{serial:04d}" />
              <p className="text-xs text-muted-foreground mt-1">
                Variables: {"{project_code}"}, {"{contractor_code}"}, {"{discipline_code}"}, {"{doc_type}"}, {"{serial:04d}"}
              </p>
            </div>
          </div>

          <div className="flex gap-2">
            {existing && <Button variant="outline" size="sm" onClick={loadExisting}>Load Existing</Button>}
            <Button size="sm" onClick={() => saveMutation.mutate()} disabled={!projectCode || saveMutation.isPending}>
              {saveMutation.isPending ? "Saving..." : existing ? "Update Config" : "Save Config"}
            </Button>
          </div>

          {configs.length > 0 && (
            <div className="border rounded-lg divide-y mt-4">
              {configs.map((c) => (
                <div key={c.id} className="flex items-center justify-between px-4 py-2 text-sm">
                  <div>
                    <span className="font-medium">{c.doc_type}</span>
                    <span className="text-muted-foreground ml-2">{c.project_code}-{c.contractor_code}-[disc]-{c.doc_type}-{String(c.serial_start).padStart(4, "0")}</span>
                  </div>
                  <Button variant="ghost" size="sm" className="text-destructive" onClick={() => deleteMutation.mutate(c.id)}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <ProjectApproversCard projectId={projectId} />
    </div>
  );
}
