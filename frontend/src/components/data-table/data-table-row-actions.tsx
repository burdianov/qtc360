"use client";

import { useState } from "react";
import { MoreHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";

export interface RowAction<TData> {
  label: string | ((row: TData) => string);
  onClick: (row: TData) => void;
  destructive?: boolean;
  separator?: boolean;
  confirm?: string | ((row: TData) => string);
}

interface DataTableRowActionsProps<TData> {
  row: TData;
  actions: RowAction<TData>[];
}

export function DataTableRowActions<TData>({ row, actions }: DataTableRowActionsProps<TData>) {
  const [confirmAction, setConfirmAction] = useState<RowAction<TData> | null>(null);

  const resolveLabel = (action: RowAction<TData>) =>
    typeof action.label === "function" ? action.label(row) : action.label;

  const resolveConfirm = (action: RowAction<TData>) =>
    typeof action.confirm === "function" ? action.confirm(row) : action.confirm;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger className="inline-flex items-center justify-center h-8 w-8 rounded-md hover:bg-accent hover:text-accent-foreground">
          <MoreHorizontal className="h-4 w-4" />
          <span className="sr-only">Open menu</span>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {actions.map((action, i) => (
            <span key={i}>
              {action.separator && <DropdownMenuSeparator />}
              <DropdownMenuItem
                onClick={() => action.confirm ? setConfirmAction(action) : action.onClick(row)}
                className={action.destructive ? "text-destructive" : undefined}
              >
                {resolveLabel(action)}
              </DropdownMenuItem>
            </span>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={!!confirmAction} onOpenChange={(open) => { if (!open) setConfirmAction(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{confirmAction ? resolveLabel(confirmAction) : "Confirm"}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">{confirmAction ? resolveConfirm(confirmAction) : ""}</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmAction(null)}>Cancel</Button>
            <Button variant="destructive" onClick={() => { confirmAction?.onClick(row); setConfirmAction(null); }}>
              {confirmAction ? resolveLabel(confirmAction) : "Confirm"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
