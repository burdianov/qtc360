"use client";

import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface RejectedDoc {
  id: string;
  reference_no: string;
  revision_no: number;
  title: string;
  document_type: string;
  full_reference_no?: string;
  discipline_id: string | null;
}

interface MirSubmissionModeCardProps {
  isEdit: boolean;
  submissionMode: "new" | "revision";
  setSubmissionMode: (mode: "new" | "revision") => void;
  rejectedDocs: Record<string, RejectedDoc[]>;
  disciplines: { id: string; name: string }[];
  revisionOfId: string | null;
  setRevisionOfId: (id: string | null) => void;
  programmaticDirtyRef: React.MutableRefObject<boolean>;
}

export function MirSubmissionModeCard({
  isEdit,
  submissionMode,
  setSubmissionMode,
  rejectedDocs,
  disciplines,
  revisionOfId,
  setRevisionOfId,
  programmaticDirtyRef,
}: MirSubmissionModeCardProps) {
  if (isEdit) return null;

  const rejectedEntries = Object.entries(rejectedDocs).flatMap(
    ([disciplineId, docs]) =>
      docs.map((doc) => ({
        ...doc,
        _disciplineId: disciplineId,
      })),
  );

  // Group by discipline for display
  const byDiscipline = new Map<string, RejectedDoc[]>();
  for (const doc of rejectedEntries) {
    const dId = doc._disciplineId;
    if (!byDiscipline.has(dId)) byDiscipline.set(dId, []);
    byDiscipline.get(dId)!.push(doc);
  }

  return (
    <Card>
      <CardContent className="pt-6 space-y-4">
        <div className="flex gap-4">
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name="submissionMode"
              checked={submissionMode === "new"}
              onChange={() => {
                setSubmissionMode("new");
                setRevisionOfId(null);
              }}
            />
            <span className="text-sm font-medium">New Submission</span>
          </label>
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name="submissionMode"
              checked={submissionMode === "revision"}
              onChange={() => setSubmissionMode("revision")}
            />
            <span className="text-sm font-medium">Revision</span>
          </label>
        </div>
        {submissionMode === "revision" && rejectedEntries.length > 0 && (
          <div>
            <label className="text-sm font-medium mb-1.5 block">
              Select Rejected Document
            </label>
            <Select
              value={revisionOfId || ""}
              onValueChange={(v) => {
                setRevisionOfId(v || null);
                programmaticDirtyRef.current = true;
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select rejected document" />
              </SelectTrigger>
              <SelectContent>
                {Array.from(byDiscipline.entries()).map(
                  ([discId, docs]) => {
                    const disc = disciplines.find((d) => d.id === discId);
                    return (
                      <div key={discId}>
                        <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground">
                          {disc?.name || discId}
                        </div>
                        {docs.map((doc) => (
                          <SelectItem key={doc.id} value={doc.id}>
                            {doc.full_reference_no || doc.reference_no} -{" "}
                            {doc.title}
                          </SelectItem>
                        ))}
                      </div>
                    );
                  },
                )}
              </SelectContent>
            </Select>
          </div>
        )}
        {submissionMode === "revision" && rejectedEntries.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No rejected documents available for revision
          </p>
        )}
      </CardContent>
    </Card>
  );
}
