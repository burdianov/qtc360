"use client";

import { useState, useRef, useEffect } from "react";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import api from "@/lib/api";
import { toast } from "sonner";
import { Upload, Trash2, X, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

function useSignatureImage(userId: string | undefined, hasSignature: boolean, version: number) {
  const [url, setUrl] = useState<string | null>(null);
  const urlRef = useRef<string | null>(null);

  useEffect(() => {
    if (!userId || !hasSignature) {
      if (urlRef.current) { URL.revokeObjectURL(urlRef.current); urlRef.current = null; }
      setUrl(null);
      return;
    }
    let cancelled = false;
    api.get(`/auth/users/${userId}/signature`, { responseType: "blob" })
      .then((res) => {
        if (cancelled) return;
        if (urlRef.current) URL.revokeObjectURL(urlRef.current);
        const blobUrl = URL.createObjectURL(res.data);
        urlRef.current = blobUrl;
        setUrl(blobUrl);
      })
      .catch(() => { if (!cancelled) setUrl(null); });
    return () => { cancelled = true; };
  }, [userId, hasSignature, version]);

  // Cleanup on unmount
  useEffect(() => () => { if (urlRef.current) URL.revokeObjectURL(urlRef.current); }, []);

  return url;
}

export default function ProfilePage() {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [localPreview, setLocalPreview] = useState<string | null>(null);
  const [fetchVersion, setFetchVersion] = useState(0);
  const [showPreview, setShowPreview] = useState(false);

  const { data: user } = useQuery({
    queryKey: ["auth", "me"],
    queryFn: async () => (await api.get("/auth/me")).data,
  });

  const hasSignature = !!user?.signature_path;
  const remoteUrl = useSignatureImage(user?.id, hasSignature, fetchVersion);

  // Display priority: local preview (just uploaded) > remote fetched > nothing
  const displayUrl = localPreview || remoteUrl;

  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      const form = new FormData();
      form.append("file", file);
      return (await api.post("/auth/me/signature", form)).data;
    },
    onSuccess: () => {
      toast.success("Signature uploaded");
      qc.invalidateQueries({ queryKey: ["auth", "me"] });
      qc.invalidateQueries({ queryKey: ["users"] });
      // Trigger refetch of remote image after query settles
      setTimeout(() => setFetchVersion((v) => v + 1), 500);
    },
    onError: () => {
      toast.error("Upload failed");
      setLocalPreview(null);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async () => (await api.delete("/auth/me/signature")).data,
    onSuccess: () => {
      toast.success("Signature removed");
      setLocalPreview(null);
      qc.invalidateQueries({ queryKey: ["auth", "me"] });
      qc.invalidateQueries({ queryKey: ["users"] });
    },
  });

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/png")) {
      toast.error("Only PNG files are accepted");
      return;
    }
    // Show immediately as local preview
    if (localPreview) URL.revokeObjectURL(localPreview);
    setLocalPreview(URL.createObjectURL(file));
    uploadMutation.mutate(file);
    e.target.value = "";
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Profile</h1>
        <p className="text-sm text-muted-foreground">
          Manage your account preferences
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Your Information</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <div>
            <span className="text-muted-foreground w-24 inline-block">Name:</span>{" "}
            {user?.full_name}
          </div>
          <div>
            <span className="text-muted-foreground w-24 inline-block">Email:</span>{" "}
            {user?.email}
          </div>
          <div>
            <span className="text-muted-foreground w-24 inline-block">Designation:</span>{" "}
            {user?.designation?.name || (
              <span className="text-muted-foreground italic">Not assigned</span>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Digital Signature</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Upload a PNG image of your signature (transparent background recommended). This will appear on generated PDF documents.
          </p>

          <div className="flex items-center gap-4">
            <div
              className="border rounded-md px-4 py-2 bg-muted/30 flex items-center justify-center h-14 min-w-[160px] cursor-pointer hover:border-primary/50 transition-colors"
              onClick={() => displayUrl && setShowPreview(true)}
            >
              {displayUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={displayUrl} alt="Signature" className="max-h-10 max-w-[200px] object-contain" />
              ) : (
                <span className="text-xs text-muted-foreground italic">No signature</span>
              )}
            </div>
            <div className="flex gap-2">
              <input ref={fileRef} type="file" accept="image/png" className="hidden" onChange={handleFile} />
              <Button
                variant="outline"
                size="sm"
                onClick={() => fileRef.current?.click()}
                disabled={uploadMutation.isPending}
              >
                {uploadMutation.isPending ? <Spinner size="sm" className="mr-1" /> : <Upload className="h-4 w-4 mr-1" />}
                {hasSignature || localPreview ? "Replace" : "Upload"}
              </Button>
              {(hasSignature || localPreview) && (
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => deleteMutation.mutate()}
                  disabled={deleteMutation.isPending}
                >
                  <Trash2 className="h-4 w-4 mr-1" />
                  Remove
                </Button>
              )}
            </div>
          </div>

          {/* PDF Display Settings */}
          <SignatureDisplaySettings />
        </CardContent>
      </Card>

      <DelegationCard />

      {/* Signature preview modal */}
      {showPreview && displayUrl && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => setShowPreview(false)}>
          <div className="relative bg-background rounded-lg p-6 shadow-xl max-w-lg" onClick={(e) => e.stopPropagation()}>
            <button onClick={() => setShowPreview(false)} className="absolute top-2 right-2 p-1 rounded hover:bg-accent">
              <X className="h-4 w-4" />
            </button>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={displayUrl} alt="Signature preview" className="max-h-[300px] max-w-full object-contain" />
          </div>
        </div>
      )}
    </div>
  );
}

function SignatureDisplaySettings() {
  const qc = useQueryClient();
  const [settings, setSettings] = useState({ cell_width: 75, cell_height: 25, x_offset: 0, y_offset: 0 });
  const [initial, setInitial] = useState({ cell_width: 75, cell_height: 25, x_offset: 0, y_offset: 0 });
  const [loaded, setLoaded] = useState(false);

  const { data: prefs } = useQuery<Record<string, any>>({
    queryKey: ["auth", "me", "preferences"],
    queryFn: async () => (await api.get("/auth/me/preferences")).data,
  });

  useEffect(() => {
    if (prefs && !loaded) {
      if (prefs.signature_display) {
        try {
          const raw = prefs.signature_display;
          const parsed = typeof raw === "string" ? { ...settings, ...JSON.parse(raw) } : { ...settings, ...raw };
          setSettings(parsed);
          setInitial(parsed);
        } catch {}
      }
      setLoaded(true);
    }
  }, [prefs, loaded]); // eslint-disable-line react-hooks/exhaustive-deps

  const isDirty = JSON.stringify(settings) !== JSON.stringify(initial);

  const saveMutation = useMutation({
    mutationFn: async () => api.put("/auth/me/preferences/signature_display", { value: settings }),
    onSuccess: () => {
      toast.success("Display settings saved");
      setInitial(settings);
      qc.invalidateQueries({ queryKey: ["auth", "me", "preferences"] });
    },
  });

  return (
    <div className="border-t pt-4 mt-4 space-y-3">
      <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">PDF Display Settings</label>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">Width (pt)</label>
          <Input type="number" value={settings.cell_width} onChange={(e) => setSettings((s) => ({ ...s, cell_width: Number(e.target.value) || 0 }))} />
        </div>
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">Height (pt)</label>
          <Input type="number" value={settings.cell_height} onChange={(e) => setSettings((s) => ({ ...s, cell_height: Number(e.target.value) || 0 }))} />
        </div>
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">X Offset (pt)</label>
          <Input value={settings.x_offset} onChange={(e) => { const v = e.target.value; if (/^-?\d*\.?\d?$/.test(v)) setSettings((s) => ({ ...s, x_offset: v as any })); }} onBlur={() => setSettings((s) => ({ ...s, x_offset: Number(s.x_offset) || 0 }))} />
        </div>
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">Y Offset (pt)</label>
          <Input value={settings.y_offset} onChange={(e) => { const v = e.target.value; if (/^-?\d*\.?\d?$/.test(v)) setSettings((s) => ({ ...s, y_offset: v as any })); }} onBlur={() => setSettings((s) => ({ ...s, y_offset: Number(s.y_offset) || 0 }))} />
        </div>
      </div>
      <Button size="sm" onClick={() => saveMutation.mutate()} disabled={!isDirty || saveMutation.isPending}>
        {saveMutation.isPending ? "Saving..." : "Save Display Settings"}
      </Button>
    </div>
  );
}


function DelegationCard() {
  const qc = useQueryClient();
  const [selectedUser, setSelectedUser] = useState("");

  const { data: users = [] } = useQuery<{ id: string; full_name: string }[]>({
    queryKey: ["users"],
    queryFn: async () => (await api.get("/auth/users")).data,
  });

  const { data: delegations = [] } = useQuery<{ id: string; delegate_id: string; delegate_name: string }[]>({
    queryKey: ["my-delegations"],
    queryFn: async () => (await api.get("/auth/me/delegations")).data,
  });

  const { data: me } = useQuery({ queryKey: ["auth", "me"], queryFn: async () => (await api.get("/auth/me")).data });

  const grantMutation = useMutation({
    mutationFn: async (delegate_id: string) => (await api.post("/auth/me/delegations", { delegate_id })).data,
    onSuccess: () => {
      toast.success("Delegation granted");
      setSelectedUser("");
      qc.invalidateQueries({ queryKey: ["my-delegations"] });
    },
    onError: (e: any) => toast.error(e.response?.data?.detail || "Failed"),
  });

  const revokeMutation = useMutation({
    mutationFn: async (id: string) => (await api.delete(`/auth/me/delegations/${id}`)).data,
    onSuccess: () => {
      toast.success("Delegation revoked");
      qc.invalidateQueries({ queryKey: ["my-delegations"] });
    },
  });

  const delegatedIds = new Set(delegations.map((d) => d.delegate_id));
  const availableUsers = users.filter((u) => u.id !== me?.id && !delegatedIds.has(u.id));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Signature Delegation</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Grant other users the right to sign documents on your behalf. Your signature will be used.
        </p>

        {/* Grant new */}
        <div className="flex items-end gap-2">
          <div className="flex-1 max-w-xs">
            <Select value={selectedUser} onValueChange={setSelectedUser}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Select a user...">
                  {selectedUser ? availableUsers.find((u) => u.id === selectedUser)?.full_name || "" : ""}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {availableUsers.map((u) => (
                  <SelectItem key={u.id} value={u.id}>{u.full_name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button
            size="sm"
            disabled={!selectedUser || grantMutation.isPending}
            onClick={() => grantMutation.mutate(selectedUser)}
          >
            <UserPlus className="h-4 w-4 mr-1" />
            Grant
          </Button>
        </div>

        {/* Current delegations */}
        {delegations.length > 0 && (
          <div className="space-y-1.5">
            <label className="text-xs text-muted-foreground">Can sign on your behalf:</label>
            {delegations.map((d) => (
              <div key={d.id} className="flex items-center justify-between rounded-md border px-3 py-2">
                <span className="text-sm">{d.delegate_name}</span>
                <button
                  className="text-muted-foreground hover:text-destructive p-0.5"
                  onClick={() => revokeMutation.mutate(d.id)}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
