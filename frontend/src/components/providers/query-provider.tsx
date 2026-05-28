"use client";

import { QueryClient, QueryClientProvider, MutationCache } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

function formatErrorDetail(detail: unknown): string {
  if (!detail) return "";
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) {
    // FastAPI 422 returns [{loc, msg, type}, ...]
    return detail
      .map((d) => {
        if (typeof d === "string") return d;
        if (d && typeof d === "object" && "msg" in d) {
          return String((d as { msg: unknown }).msg);
        }
        return JSON.stringify(d);
      })
      .join(", ");
  }
  if (typeof detail === "object") return JSON.stringify(detail);
  return String(detail);
}

export function QueryProvider({ children }: { children: React.ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { staleTime: 30_000, retry: 1 },
        },
        mutationCache: new MutationCache({
          onError: (error: unknown) => {
            const e = error as { response?: { data?: { detail?: unknown } }; message?: string };
            const detail = e?.response?.data?.detail;
            const formatted = formatErrorDetail(detail);
            toast.error(formatted || e?.message || "An error occurred");
          },
        }),
      })
  );
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
