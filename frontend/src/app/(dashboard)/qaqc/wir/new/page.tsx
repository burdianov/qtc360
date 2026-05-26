"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { z } from "zod/v4";
import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowLeft, GripVertical, Plus, Trash2, X } from "lucide-react";
import api from "@/lib/api";
import { useSelectedProject } from "@/hooks/use-project";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Form, FormField, FormItem, FormLabel, FormControl, FormMessage } from "@/components/form";

interface Discipline { id: string; name: string; code: string; }
interface Activity { id: string; name: string; code: string; service_id: string; }
interface SubActivity { id: string; name: string; code: string; activity_id: string; }
interface Service { id: string; name: string; code: string; }
interface Employee { id: string; name: string; position: string | null; }
interface Asset { id: string; name: string; tag_number: string; }

const schema = z.object({
  subject: z.string().min(1, "Subject is required"),
  discipline_id: z.string().min(1, "Discipline is required"),
  description: z.string().min(1, "Description is required"),
  general_location: z.string().optional(),
  floor_level_room: z.string().optional(),
  approved_rams: z.string().optional(),
  drawing_reference: z.string().optional(),
  service_id: z.string().optional(),
  activity_id: z.string().optional(),
  sub_activity_id: z.string().optional(),
  inspector_1_id: z.string().optional(),
  inspector_2_id: z.string().optional(),
  date: z.string().optional(),
});

type FormValues = z.infer<typeof schema>;

export default function NewWIRPage() {
  const router = useRouter();
  const project = useSelectedProject();
  const queryClient = useQueryClient();
  const [selectedAssets, setSelectedAssets] = useState<Asset[]>([]);
  const [attachments, setAttachments] = useState<{ name: string; path: string }[]>([]);
  const [signed, setSigned] = useState<{ inspector1: boolean; inspector2: boolean }>({ inspector1: false, inspector2: false });

  const { data: disciplines = [] } = useQuery<Discipline[]>({
    queryKey: ["disciplines"],
    queryFn: async () => (await api.get("/disciplines")).data,
  });

  const { data: services = [] } = useQuery<Service[]>({
    queryKey: ["services"],
    queryFn: async () => (await api.get("/services")).data,
  });

  const { data: activities = [] } = useQuery<Activity[]>({
    queryKey: ["activities"],
    queryFn: async () => (await api.get("/activities")).data,
  });

  const { data: subActivities = [] } = useQuery<SubActivity[]>({
    queryKey: ["sub-activities"],
    queryFn: async () => (await api.get("/sub-activities")).data,
  });

  const { data: employees = [] } = useQuery<Employee[]>({
    queryKey: ["employees"],
    queryFn: async () => (await api.get("/employees")).data,
  });

  const { data: assets = [] } = useQuery<Asset[]>({
    queryKey: ["assets"],
    queryFn: async () => (await api.get("/assets")).data,
  });

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      subject: "",
      discipline_id: "",
      description: "",
      general_location: "",
      floor_level_room: "",
      approved_rams: "",
      drawing_reference: "",
      service_id: "",
      activity_id: "",
      sub_activity_id: "",
      inspector_1_id: "",
      inspector_2_id: "",
      date: new Date().toISOString().split("T")[0],
    },
  });

  const serviceId = form.watch("service_id");
  const activityId = form.watch("activity_id");
  const filteredActivities = serviceId ? activities.filter((a) => a.service_id === serviceId) : activities;
  const filteredSubActivities = activityId ? subActivities.filter((s) => s.activity_id === activityId) : [];

  const mutation = useMutation({
    mutationFn: async (values: FormValues) => {
      const disciplineCode = disciplines.find((d) => d.id === values.discipline_id)?.code || "";
      // Generate reference number
      const refRes = await api.get("/templates/ref-config/generate", {
        params: { project_id: project!.id, doc_type: "WIR", discipline_code: disciplineCode },
      });
      const payload = {
        project_id: project!.id,
        doc_type: "WIR",
        number: refRes.data.reference_number,
        title: values.subject,
        description: values.description,
        discipline_id: values.discipline_id,
        activity_id: values.activity_id || null,
        sub_activity_id: values.sub_activity_id || null,
        is_milestone_activity: !!values.activity_id,
        asset_ids: selectedAssets.map((a) => a.id),
      };
      return api.post("/documents", payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["documents", "WIR"] });
      router.push("/qaqc/wir");
    },
  });

  const addAsset = (assetId: string) => {
    const asset = assets.find((a) => a.id === assetId);
    if (asset && !selectedAssets.find((a) => a.id === assetId)) {
      setSelectedAssets([...selectedAssets, asset]);
    }
  };

  const removeAsset = (assetId: string) => {
    setSelectedAssets(selectedAssets.filter((a) => a.id !== assetId));
  };

  const addAttachment = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = true;
    input.onchange = (e) => {
      const files = (e.target as HTMLInputElement).files;
      if (files) {
        const newAttachments = Array.from(files).map((f) => ({ name: f.name, path: f.name }));
        setAttachments([...attachments, ...newAttachments]);
      }
    };
    input.click();
  };

  const removeAttachment = (index: number) => {
    setAttachments(attachments.filter((_, i) => i !== index));
  };

  return (
    <div className="space-y-6 max-w-4xl">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="sm" onClick={() => router.push("/qaqc/wir")}>
          <ArrowLeft className="h-4 w-4 mr-1" />Back
        </Button>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">New Work Inspection Request</h1>
          <p className="text-sm text-muted-foreground">Fill in the WIR submission form</p>
        </div>
      </div>

      <Form {...form}>
        <form onSubmit={form.handleSubmit((v) => mutation.mutate(v))} noValidate className="space-y-6">

          {/* Basic Info */}
          <Card>
            <CardHeader><CardTitle className="text-base">General Information</CardTitle></CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <FormField control={form.control} name="date" render={({ field }) => (
                <FormItem><FormLabel>Date</FormLabel><FormControl><Input type="date" {...field} /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="discipline_id" render={({ field }) => (
                <FormItem>
                  <FormLabel>Discipline *</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl><SelectTrigger><SelectValue placeholder="Select discipline" /></SelectTrigger></FormControl>
                    <SelectContent>{disciplines.map((d) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}</SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />
              <div className="sm:col-span-2">
                <FormField control={form.control} name="subject" render={({ field }) => (
                  <FormItem><FormLabel>Subject *</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
                )} />
              </div>
              <div className="sm:col-span-2">
                <FormField control={form.control} name="description" render={({ field }) => (
                  <FormItem><FormLabel>Description of Inspection *</FormLabel><FormControl><Textarea rows={3} {...field} /></FormControl><FormMessage /></FormItem>
                )} />
              </div>
              <FormField control={form.control} name="general_location" render={({ field }) => (
                <FormItem><FormLabel>General Location</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="floor_level_room" render={({ field }) => (
                <FormItem><FormLabel>Floor / Level / Room</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="approved_rams" render={({ field }) => (
                <FormItem><FormLabel>Approved RAMS Inspection</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="drawing_reference" render={({ field }) => (
                <FormItem><FormLabel>Drawing Reference</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
              )} />
            </CardContent>
          </Card>

          {/* Activity & Assets */}
          <Card>
            <CardHeader><CardTitle className="text-base">Activity & Assets</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-3">
                <FormField control={form.control} name="service_id" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Service</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl><SelectTrigger><SelectValue placeholder="Select service" /></SelectTrigger></FormControl>
                      <SelectContent>{services.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent>
                    </Select>
                  </FormItem>
                )} />
                <FormField control={form.control} name="activity_id" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Activity</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl><SelectTrigger><SelectValue placeholder="Select activity" /></SelectTrigger></FormControl>
                      <SelectContent>{filteredActivities.map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}</SelectContent>
                    </Select>
                  </FormItem>
                )} />
                <FormField control={form.control} name="sub_activity_id" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Sub-Activity</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl><SelectTrigger><SelectValue placeholder="Select sub-activity" /></SelectTrigger></FormControl>
                      <SelectContent>{filteredSubActivities.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent>
                    </Select>
                  </FormItem>
                )} />
              </div>

              <Separator />

              {/* Asset Selection */}
              <div>
                <FormLabel>Assets</FormLabel>
                <div className="mt-2 flex gap-2">
                  <Select onValueChange={(v) => v && addAsset(v as string)}>
                    <SelectTrigger className="flex-1"><SelectValue placeholder="Add asset..." /></SelectTrigger>
                    <SelectContent>
                      {assets.filter((a) => !selectedAssets.find((s) => s.id === a.id)).map((a) => (
                        <SelectItem key={a.id} value={a.id}>{a.tag_number} — {a.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {selectedAssets.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {selectedAssets.map((asset) => (
                      <Badge key={asset.id} variant="secondary" className="gap-1 pr-1">
                        {asset.tag_number}
                        <button type="button" onClick={() => removeAsset(asset.id)} className="ml-1 hover:text-destructive">
                          <X className="h-3 w-3" />
                        </button>
                      </Badge>
                    ))}
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Inspectors & Signatures */}
          <Card>
            <CardHeader><CardTitle className="text-base">Inspectors & Signatures</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-3">
                  <FormField control={form.control} name="inspector_1_id" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Inspected by 1</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl><SelectTrigger><SelectValue placeholder="Select inspector" /></SelectTrigger></FormControl>
                        <SelectContent>{employees.map((e) => <SelectItem key={e.id} value={e.id}>{e.name}{e.position ? ` — ${e.position}` : ""}</SelectItem>)}</SelectContent>
                      </Select>
                    </FormItem>
                  )} />
                  {/* Signature field */}
                  <div
                    className={`h-16 rounded-md border-2 border-dashed flex items-center justify-center cursor-pointer transition-colors ${signed.inspector1 ? "border-emerald-500/50 bg-emerald-500/5" : "border-border hover:border-primary/50"}`}
                    onClick={() => form.getValues("inspector_1_id") && setSigned((s) => ({ ...s, inspector1: !s.inspector1 }))}
                  >
                    {signed.inspector1 ? (
                      <span className="text-lg italic font-serif text-emerald-500">
                        {employees.find((e) => e.id === form.getValues("inspector_1_id"))?.name || "Signed"}
                      </span>
                    ) : (
                      <span className="text-sm text-muted-foreground">Click to sign</span>
                    )}
                  </div>
                </div>
                <div className="space-y-3">
                  <FormField control={form.control} name="inspector_2_id" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Inspected by 2</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl><SelectTrigger><SelectValue placeholder="Select inspector" /></SelectTrigger></FormControl>
                        <SelectContent>{employees.map((e) => <SelectItem key={e.id} value={e.id}>{e.name}{e.position ? ` — ${e.position}` : ""}</SelectItem>)}</SelectContent>
                      </Select>
                    </FormItem>
                  )} />
                  <div
                    className={`h-16 rounded-md border-2 border-dashed flex items-center justify-center cursor-pointer transition-colors ${signed.inspector2 ? "border-emerald-500/50 bg-emerald-500/5" : "border-border hover:border-primary/50"}`}
                    onClick={() => form.getValues("inspector_2_id") && setSigned((s) => ({ ...s, inspector2: !s.inspector2 }))}
                  >
                    {signed.inspector2 ? (
                      <span className="text-lg italic font-serif text-emerald-500">
                        {employees.find((e) => e.id === form.getValues("inspector_2_id"))?.name || "Signed"}
                      </span>
                    ) : (
                      <span className="text-sm text-muted-foreground">Click to sign</span>
                    )}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Attachments */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-base">Attachments</CardTitle>
              <Button type="button" variant="outline" size="sm" onClick={addAttachment}>
                <Plus className="h-4 w-4 mr-1" />Add Files
              </Button>
            </CardHeader>
            <CardContent>
              {attachments.length === 0 ? (
                <p className="text-sm text-muted-foreground">No attachments added yet.</p>
              ) : (
                <div className="space-y-2">
                  {attachments.map((att, i) => (
                    <div key={i} className="flex items-center gap-3 rounded-md border border-border px-3 py-2">
                      <GripVertical className="h-4 w-4 text-muted-foreground cursor-grab" />
                      <span className="flex-1 text-sm truncate">{att.name}</span>
                      <button type="button" onClick={() => removeAttachment(i)} className="text-muted-foreground hover:text-destructive">
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Actions */}
          <div className="flex justify-end gap-3">
            <Button type="button" variant="outline" onClick={() => router.push("/qaqc/wir")}>Cancel</Button>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? "Saving..." : "Save as Draft"}
            </Button>
          </div>
        </form>
      </Form>
    </div>
  );
}
