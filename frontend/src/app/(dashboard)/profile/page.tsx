"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import api from "@/lib/api";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface Font { id: string; name: string; }

export default function ProfilePage() {
  const router = useRouter();
  const qc = useQueryClient();
  const [selectedFont, setSelectedFont] = useState("dancing_script");
  const [signatureText, setSignatureText] = useState("");
  const [initialFont, setInitialFont] = useState("dancing_script");
  const [initialText, setInitialText] = useState("");

  const { data: user } = useQuery({
    queryKey: ["auth", "me"],
    queryFn: async () => (await api.get("/auth/me")).data,
  });

  const { data: fonts = [] } = useQuery<Font[]>({
    queryKey: ["signature-fonts"],
    queryFn: async () => (await api.get("/reports/signature-fonts")).data,
  });

  useEffect(() => {
    if (user) {
      const font = user.signature_font || "dancing_script";
      const text = user.signature_text || user.full_name || "";
      setSelectedFont(font);
      setSignatureText(text);
      setInitialFont(font);
      setInitialText(text);
    }
  }, [user]);

  const isDirty = selectedFont !== initialFont || signatureText !== initialText;

  const saveMutation = useMutation({
    mutationFn: () => api.patch("/auth/me", { signature_font: selectedFont, signature_text: signatureText }),
    onSuccess: () => {
      toast.success("Signature style saved");
      setInitialFont(selectedFont);
      setInitialText(signatureText);
      qc.invalidateQueries({ queryKey: ["auth", "me"] });
    },
  });

  const previewName = signatureText || user?.full_name || "Your Name";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Profile</h1>
        <p className="text-sm text-muted-foreground">Manage your account preferences</p>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Your Information</CardTitle></CardHeader>
        <CardContent className="space-y-2 text-sm">
          <div><span className="text-muted-foreground w-24 inline-block">Name:</span> {user?.full_name}</div>
          <div><span className="text-muted-foreground w-24 inline-block">Email:</span> {user?.email}</div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Signature Style</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">Choose how your signature appears on generated documents.</p>

          <div className="space-y-1.5 max-w-sm">
            <label className="text-xs text-muted-foreground">Signature Text</label>
            <Input
              value={signatureText}
              onChange={(e) => setSignatureText(e.target.value)}
              placeholder={user?.full_name || "Your Name"}
            />
            <p className="text-xs text-muted-foreground">Customize if your full name is too long or you prefer a different signing style.</p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {fonts.map((font) => (
              <button
                key={font.id}
                onClick={() => setSelectedFont(font.id)}
                className={`p-4 rounded-lg border text-left transition-all ${selectedFont === font.id ? "border-primary ring-2 ring-primary/20 bg-primary/5" : "border-border hover:border-primary/50"}`}
              >
                <span className="text-xs text-muted-foreground block mb-2">{font.name}</span>
                <img
                  src={`${api.defaults.baseURL}/reports/signature-preview?name=${encodeURIComponent(previewName)}&font_id=${font.id}&color=%23a5b4fc`}
                  alt={font.name}
                  className="h-10 object-contain"
                />
              </button>
            ))}
          </div>

          <div className="flex items-center justify-between pt-2">
            <Button variant="outline" size="sm" onClick={() => router.back()}>
              ← Back
            </Button>
            <Button onClick={() => saveMutation.mutate()} disabled={!isDirty || saveMutation.isPending}>
              {saveMutation.isPending ? "Saving..." : "Save Signature Style"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
