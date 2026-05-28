"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2, GripVertical } from "lucide-react";
import { toast } from "sonner";

import api from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type DocType = "WIR" | "MIR" | "CIR" | "FAT";
const DOC_TYPES: DocType[] = ["WIR", "MIR", "CIR", "FAT"];

interface Approver {
  id: string;
  name: string;
  code: string;
}

interface ProjectApprover {
  id: string;
  project_id: string;
  document_type: string | null;
  approver_order: number | null;
  approver: Approver;
}

export function ProjectApproversCard({ projectId }: { projectId: string | undefined }) {
  const qc = useQueryClient();
  const [docType, setDocType] = useState<DocType>("WIR");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedApproverId, setSelectedApproverId] = useState("");

  const { data: projectApprovers = [] } = useQuery<ProjectApprover[]>({
    queryKey: ["project-approvers", projectId],
    queryFn: async () => (await api.get("/project-approvers", { params: { project_id: projectId } })).data,
    enabled: !!projectId,
  });

  const { data: allApprovers = [] } = useQuery<Approver[]>({
    queryKey: ["approvers"],
    queryFn: async () => (await api.get("/approvers")).data,
  });

  const chain = useMemo(() => {
    return projectApprovers
      .filter((pa) => pa.document_type === docType)
      .sort((a, b) => (a.approver_order ?? 0) - (b.approver_order ?? 0));
  }, [projectApprovers, docType]);

  const nextOrder = chain.length > 0
    ? Math.max(...chain.map((c) => c.approver_order ?? 0)) + 1
    : 1;

  const usedIds = new Set(chain.map((c) => c.approver.id));
  const availableApprovers = allApprovers.filter((a) => !usedIds.has(a.id));

  const addMutation = useMutation({
    mutationFn: (approverId: string) =>
      api.post("/project-approvers", {
        project_id: projectId,
        approver_id: approverId,
        document_type: docType,
        approver_order: nextOrder,
      }),
    onSuccess: () => {
      toast.success("Approver added");
      qc.invalidateQueries({ queryKey: ["project-approvers", projectId] });
      setDialogOpen(false);
      setSelectedApproverId("");
    },
    onError: (err: unknown) => {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      toast.error(detail || "Could not add approver");
    },
  });

  const removeMutation = useMutation({
    mutationFn: async (paId: string) => {
      await api.delete(`/project-approvers/${paId}`);
      // Re-sequence remaining orders so we don't leave a gap (e.g. removing
      // order 1 from a 1→2 chain should promote order 2 to order 1).
      const remaining = chain
        .filter((c) => c.id !== paId)
        .sort((a, b) => (a.approver_order ?? 0) - (b.approver_order ?? 0));
      for (let i = 0; i < remaining.length; i++) {
        const target = i + 1;
        if (remaining[i].approver_order !== target) {
          await api.patch(`/project-approvers/${remaining[i].id}`, { approver_order: target });
        }
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["project-approvers", projectId] });
    },
  });

  if (!projectId) {
    return (
      <Card>
        <CardHeader><CardTitle className="text-base">Project Approvers</CardTitle></CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">Select a project to configure its approver chain.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Project Approvers</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          External approval chain by document type. WIR/MIR and CIR usually go through different parties.
        </p>

        <div className="flex flex-wrap items-center gap-1 rounded-lg border p-1 w-fit">
          {DOC_TYPES.map((dt) => (
            <button
              key={dt}
              onClick={() => setDocType(dt)}
              className={
                "px-3 py-1.5 text-xs font-medium rounded-md transition " +
                (dt === docType
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground hover:text-foreground")
              }
            >
              {dt}
            </button>
          ))}
        </div>

        {chain.length === 0 ? (
          <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
            No approver chain configured for {docType} on this project.
          </div>
        ) : (
          <div className="rounded-lg border divide-y">
            {chain.map((pa) => (
              <div key={pa.id} className="flex items-center gap-3 px-4 py-3">
                <GripVertical className="h-4 w-4 text-muted-foreground" />
                <div className="flex h-7 w-7 items-center justify-center rounded-full bg-muted text-xs font-semibold">
                  {pa.approver_order}
                </div>
                <div className="flex-1">
                  <div className="text-sm font-medium">{pa.approver.name}</div>
                  <div className="text-xs text-muted-foreground">{pa.approver.code}</div>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-destructive"
                  onClick={() => removeMutation.mutate(pa.id)}
                  disabled={removeMutation.isPending}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>
        )}

        <Button
          size="sm"
          onClick={() => { setSelectedApproverId(""); setDialogOpen(true); }}
          disabled={availableApprovers.length === 0}
        >
          <Plus className="mr-2 h-4 w-4" />
          Add approver to {docType} chain
        </Button>

        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add approver — {docType} order {nextOrder}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Pick the approval party (company) for position {nextOrder} in the {docType} chain.
              </p>
              <div>
                <label className="text-xs text-muted-foreground mb-1.5 block">Approver</label>
                <Select value={selectedApproverId} onValueChange={setSelectedApproverId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select approver">
                      {selectedApproverId
                        ? availableApprovers.find((a) => a.id === selectedApproverId)?.name
                        : ""}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {availableApprovers.map((a) => (
                      <SelectItem key={a.id} value={a.id}>
                        {a.name} ({a.code})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
                  Cancel
                </Button>
                <Button
                  type="button"
                  disabled={!selectedApproverId || addMutation.isPending}
                  onClick={() => addMutation.mutate(selectedApproverId)}
                >
                  {addMutation.isPending ? "Adding..." : "Add"}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}
