"use client";

/* eslint-disable @next/next/no-img-element */

import { useState, useEffect } from "react";
import api from "@/lib/api";

export function SignatureImage({ userId }: { userId: string | undefined }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    if (!userId) return;
    const controller = new AbortController();
    let objectUrl: string | null = null;
    api
      .get(`/auth/users/${userId}/signature`, {
        responseType: "blob",
        signal: controller.signal,
      })
      .then((res) => {
        objectUrl = URL.createObjectURL(res.data);
        setSrc(objectUrl);
      })
      .catch((err: any) => {
        if (
          err &&
          typeof err === "object" &&
          "code" in err &&
          err.code === "ERR_CANCELED"
        )
          return;
        console.error("Failed to load signature image:", err);
      });
    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [userId]);
  if (!src)
    return <span className="text-xs text-muted-foreground">Signed</span>;
  return (
    <img src={src} alt="Signature" className="h-10 max-w-full object-contain" />
  );
}
