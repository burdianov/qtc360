"use client";

import type { UseFormReturn } from "react-hook-form";
import type { CirFormValues, Discipline } from "../_lib/cir-form";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { DatePicker } from "@/components/ui/date-picker";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  FormField,
  FormItem,
  FormLabel,
  FormControl,
  FormMessage,
} from "@/components/form";

interface CirGeneralInfoCardProps {
  form: UseFormReturn<CirFormValues>;
  disciplines: Discipline[];
  docTemplates: { id: string; name: string; version: number; is_active: boolean }[];
  selectedTemplateId: string;
  setSelectedTemplateId: (id: string) => void;
  programmaticDirtyRef: React.MutableRefObject<boolean>;
  referenceNo: string;
  revisionNo: number;
}

export function CirGeneralInfoCard({
  form,
  disciplines,
  docTemplates,
  selectedTemplateId,
  setSelectedTemplateId,
  programmaticDirtyRef,
  referenceNo,
  revisionNo,
}: CirGeneralInfoCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">General Information</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4 sm:grid-cols-2">
        <FormItem>
          <FormLabel>Reference Number</FormLabel>
          <FormControl>
            <div className="flex gap-2">
              <Input
                value={referenceNo}
                disabled
                className="font-mono bg-muted flex-1"
                placeholder="Reference will be assigned on save"
              />
              {(revisionNo > 0) && (
                <div className="flex items-center px-3 rounded-md border bg-muted text-sm font-mono whitespace-nowrap">
                  Rev {revisionNo}
                </div>
              )}
            </div>
          </FormControl>
        </FormItem>
        <FormItem>
          <FormLabel>Template</FormLabel>
          <Select
            value={selectedTemplateId}
            onValueChange={(v) => {
              setSelectedTemplateId(v);
              programmaticDirtyRef.current = true;
            }}
          >
            <SelectTrigger>
              <SelectValue placeholder="Select template">
                  {(() => {
                    const t = docTemplates.find(
                      (t) => t.id === (selectedTemplateId || (docTemplates.length === 1 ? docTemplates[0].id : "")),
                    );
                    return t ? `${t.name} (v${t.version})` : "";
                  })()}
                </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {docTemplates.map((t) => (
                <SelectItem key={t.id} value={t.id}>
                  {t.name} (v{t.version}){t.is_active ? " ✓" : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FormItem>
        <FormField
          control={form.control}
          name="date"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Date *</FormLabel>
              <FormControl>
                <DatePicker
                  value={field.value || undefined}
                  onChange={(d) => field.onChange(d)}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="discipline_id"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Discipline *</FormLabel>
              <Select
                onValueChange={(v) => {
                  field.onChange(v);
                  programmaticDirtyRef.current = true;
                }}
                value={field.value}
              >
                <FormControl>
                  <SelectTrigger>
                    <SelectValue placeholder="Select discipline">
                      {disciplines.find((d) => d.id === field.value)
                        ?.name || ""}
                    </SelectValue>
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {disciplines.map((d) => (
                    <SelectItem key={d.id} value={d.id}>
                      {d.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />
        <div className="sm:col-span-2">
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
        </div>
        <div className="sm:col-span-2">
          <FormField
            control={form.control}
            name="description"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Description of Inspection *</FormLabel>
                <FormControl>
                  <Textarea
                    rows={3}
                    {...field}
                    placeholder="Enter description of inspection"
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>
        <FormField
          control={form.control}
          name="general_location"
          render={({ field }) => (
            <FormItem>
              <FormLabel>General Location</FormLabel>
              <FormControl>
                <Input {...field} placeholder="General location" />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="floor_level_room"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Floor / Level / Room</FormLabel>
              <FormControl>
                <Input {...field} placeholder="Floor, level, room" />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="approved_rams"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Approved RAMS</FormLabel>
              <FormControl>
                <Input {...field} placeholder="Approved RAMS reference" />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="drawing_reference"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Drawing Reference</FormLabel>
              <FormControl>
                <Input {...field} placeholder="Drawing reference" />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      </CardContent>
    </Card>
  );
}
