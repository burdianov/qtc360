"use client";

import { QueryClient, QueryClientProvider, MutationCache } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

export function QueryProvider({ children }: { children: React.ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { staleTime: 30_000, retry: 1 },
        },
        mutationCache: new MutationCache({
          onError: (error: any) => {
            toast.error(error?.response?.data?.detail || error?.message || "An error occurred");
          },
        }),
      })
  );
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
