"use client";

import { Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { SourceDoc, ApprovalRound } from "../_lib/crs-form";

interface CrsSourceDocCardProps {
  sourceDocType: string;
  setSourceDocType: (v: string) => void;
  setSelectedSourceDocId: (v: string) => void;
  setSelectedApproverOrder: (v: number | null) => void;
  selectedSourceDocId: string;
  selectedSourceDoc: SourceDoc | null;
  sourceDocs: SourceDoc[];
  selectedApproverOrder: number | null;
  approvalRounds: ApprovalRound[];
  getStatusLabel: (statusId: string | null) => string;
  copyToClipboard: (text: string) => void;
}

export function CrsSourceDocCard({
  sourceDocType,
  setSourceDocType,
  setSelectedSourceDocId,
  setSelectedApproverOrder,
  selectedSourceDocId,
  selectedSourceDoc,
  sourceDocs,
  selectedApproverOrder,
  approvalRounds,
  getStatusLabel,
  copyToClipboard,
}: CrsSourceDocCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Source Document</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="text-sm font-medium mb-1.5 block">
              Document Type
            </label>
            <Select
              value={sourceDocType}
              onValueChange={(v) => {
                setSourceDocType(v);
                setSelectedSourceDocId("");
                setSelectedApproverOrder(null);
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select type" />
              </SelectTrigger>
              <SelectContent>
                {["WIR", "MIR", "CIR"].map((t) => (
                  <SelectItem key={t} value={t}>
                    {t}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-sm font-medium mb-1.5 block">
              Document
            </label>
            <Select
              value={selectedSourceDocId}
              onValueChange={(v) => {
                setSelectedSourceDocId(v);
                setSelectedApproverOrder(null);
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select document">
                  {selectedSourceDoc
                    ? `${selectedSourceDoc.full_reference_no || selectedSourceDoc.reference_no} - ${selectedSourceDoc.title}`
                    : ""}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {sourceDocs.map((d) => (
                  <SelectItem key={d.id} value={d.id}>
                    {d.full_reference_no || d.reference_no} - {d.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {selectedSourceDoc && (
          <div className="rounded-md border p-4 space-y-3">
            <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
              <span className="font-medium text-muted-foreground">Ref:</span>
              <div className="flex items-center gap-2">
                <span className="select-all">
                  {selectedSourceDoc.reference_no}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-5 w-5"
                  onClick={() =>
                    copyToClipboard(
                      selectedSourceDoc.full_reference_no ||
                        selectedSourceDoc.reference_no,
                    )
                  }
                >
                  <Copy className="h-3 w-3" />
                </Button>
              </div>
              <span className="font-medium text-muted-foreground">Rev:</span>
              <span>{selectedSourceDoc.revision_no}</span>
              <span className="font-medium text-muted-foreground">
                Status:
              </span>
              <span className="capitalize">
                {(selectedSourceDoc as any).status?.replace(/_/g, " ") || ""}
              </span>
              <span className="font-medium text-muted-foreground">
                Subject:
              </span>
              <div className="flex items-center gap-2">
                <span className="select-all">
                  {selectedSourceDoc.title}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-5 w-5"
                  onClick={() => copyToClipboard(selectedSourceDoc.title)}
                >
                  <Copy className="h-3 w-3" />
                </Button>
              </div>
              {selectedSourceDoc.description && (
                <>
                  <span className="font-medium text-muted-foreground">
                    Description:
                  </span>
                  <div className="flex items-center gap-2">
                    <span className="select-all">
                      {selectedSourceDoc.description}
                    </span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-5 w-5"
                      onClick={() =>
                        copyToClipboard(selectedSourceDoc.description!)
                      }
                    >
                      <Copy className="h-3 w-3" />
                    </Button>
                  </div>
                </>
              )}
            </div>

            {/* Approver sections */}
            {approvalRounds.length > 0 && (
              <div className="space-y-3 pt-3 border-t">
                {[1, 2].map((order) => {
                  const round = approvalRounds.find(
                    (r) => r.approver_order === order,
                  );
                  if (!round) return null;
                  const isSelected = selectedApproverOrder === order;
                  return (
                    <div
                      key={order}
                      className={`rounded-md border p-3 cursor-pointer transition-colors ${isSelected ? "border-primary bg-primary/5" : "hover:bg-accent/50"}`}
                      onClick={() => setSelectedApproverOrder(order)}
                    >
                      <div className="flex items-center gap-3">
                        <input
                          type="radio"
                          name="approver_selection"
                          checked={isSelected}
                          onChange={() => setSelectedApproverOrder(order)}
                          className="h-4 w-4"
                        />
                        <span className="text-sm font-medium">
                          Approver {order}
                        </span>
                        {round.decision_status_id && (
                          <Badge variant="outline">
                            {getStatusLabel(round.decision_status_id)}
                          </Badge>
                        )}
                      </div>
                      {round.comments && (
                        <div className="mt-2 ml-7 flex items-start gap-2">
                          <p className="text-sm text-muted-foreground select-all flex-1">
                            {round.comments}
                          </p>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-5 w-5 shrink-0"
                            onClick={(e) => {
                              e.stopPropagation();
                              copyToClipboard(round.comments!);
                            }}
                          >
                            <Copy className="h-3 w-3" />
                          </Button>
                        </div>
                      )}
                      {!round.comments && (
                        <p className="mt-2 ml-7 text-sm text-muted-foreground italic">
                          No comments
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
