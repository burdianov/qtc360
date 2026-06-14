"use client";

import type { UseFormReturn } from "react-hook-form";
import type { FatFormValues, Discipline } from "../_lib/fat-form";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
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

export function FatGeneralInfoCard({
  form,
  disciplines,
}: {
  form: UseFormReturn<FatFormValues>;
  disciplines: Discipline[];
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">General Information</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4 sm:grid-cols-2">
        <FormField
          control={form.control}
          name="reference_no"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Reference Number</FormLabel>
              <FormControl>
                <Input
                  {...field}
                  disabled
                  className="font-mono bg-muted"
                  placeholder="Reference will be assigned on save"
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
              <Select onValueChange={field.onChange} value={field.value}>
                <FormControl>
                  <SelectTrigger>
                    <SelectValue placeholder="Select discipline">
                      {field.value
                        ? disciplines.find((d) => d.id === field.value)
                            ?.name
                        : ""}
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
            name="description"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Description</FormLabel>
                <FormControl>
                  <Textarea
                    rows={3}
                    placeholder="Description"
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>
      </CardContent>
    </Card>
  );
}
