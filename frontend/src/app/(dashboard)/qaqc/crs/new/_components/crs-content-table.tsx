"use client";

import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  FormField,
  FormItem,
  FormLabel,
  FormControl,
  FormMessage,
} from "@/components/form";
import type { UseFormReturn } from "react-hook-form";
import type { CrsFormValues, CrsRow } from "../_lib/crs-form";

interface CrsContentTableProps {
  form: UseFormReturn<CrsFormValues>;
  rows: CrsRow[];
  addRow: () => void;
  removeRow: (idx: number) => void;
  updateRow: (idx: number, field: "comment" | "response", value: string) => void;
}

export function CrsContentTable({
  form,
  rows,
  addRow,
  removeRow,
  updateRow,
}: CrsContentTableProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">CRS Content</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <FormField
          control={form.control}
          name="subject"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Subject *</FormLabel>
              <FormControl>
                <Input {...field} placeholder="Enter subject" />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="rounded-md border overflow-hidden">
          <table className="w-full text-sm table-fixed">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="p-2 w-12 text-left font-medium">SN</th>
                <th className="p-2 text-left font-medium">
                  CXM&apos;s Comments
                </th>
                <th className="p-2 text-left font-medium">
                  Responses to CXM&apos;s Comments
                </th>
                <th className="p-2 w-10"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, idx) => (
                <tr key={idx} className="border-b last:border-b-0">
                  <td className="p-2 text-center align-top text-muted-foreground">
                    {row.sn}
                  </td>
                  <td className="p-2">
                    <Textarea
                      rows={2}
                      value={row.comment}
                      onChange={(e) =>
                        updateRow(idx, "comment", e.target.value)
                      }
                      placeholder="Enter comment"
                      className="resize-none min-h-[60px]"
                    />
                  </td>
                  <td className="p-2">
                    <Textarea
                      rows={2}
                      value={row.response}
                      onChange={(e) =>
                        updateRow(idx, "response", e.target.value)
                      }
                      placeholder="Enter response"
                      className="resize-none min-h-[60px]"
                    />
                  </td>
                  <td className="p-2 align-top">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-destructive"
                      onClick={() => removeRow(idx)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={addRow}>
          <Plus className="h-3.5 w-3.5 mr-1" />
          Add Row
        </Button>
      </CardContent>
    </Card>
  );
}
