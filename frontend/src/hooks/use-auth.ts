"use client";

import { useCallback } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import api from "@/lib/api";

export interface DesignationRef {
  id: string;
  name: string;
}

export interface RoleRef {
  id: string;
  name: string;
  description?: string | null;
}

export interface User {
  id: string;
  email: string;
  full_name: string;
  is_active: boolean;
  is_superuser: boolean;
  signature_font?: string | null;
  signature_text?: string | null;
  designation_id?: string | null;
  designation?: DesignationRef | null;
  roles?: RoleRef[];
  permissions?: string[];
}

export function useCurrentUser() {
  return useQuery<User>({
    queryKey: ["auth", "me"],
    queryFn: async () => (await api.get("/auth/me")).data,
    retry: false,
    enabled: typeof window !== "undefined" && !!localStorage.getItem("access_token"),
  });
}

export function useLogin() {
  const queryClient = useQueryClient();
  const router = useRouter();
  return useMutation({
    mutationFn: async (body: { email: string; password: string }) => {
      const { data } = await api.post("/auth/login", body);
      localStorage.setItem("access_token", data.access_token);
      localStorage.setItem("refresh_token", data.refresh_token);
      return data as { access_token: string; refresh_token: string; must_change_password: boolean };
    },
    onSuccess: (data) => {
      if (!data.must_change_password) {
        queryClient.invalidateQueries({ queryKey: ["auth", "me"] });
        router.push("/dashboard");
      }
    },
  });
}

export function useChangePassword() {
  const queryClient = useQueryClient();
  const router = useRouter();
  return useMutation({
    mutationFn: async (body: { current_password: string; new_password: string }) => {
      const { data } = await api.post("/auth/change-password", body);
      // Backend rotates token_version on password change and returns fresh tokens; swap them in.
      if (data?.access_token && data?.refresh_token) {
        localStorage.setItem("access_token", data.access_token);
        localStorage.setItem("refresh_token", data.refresh_token);
      }
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["auth", "me"] });
      router.push("/dashboard");
    },
  });
}

export function useLogout() {
  const queryClient = useQueryClient();
  const router = useRouter();
  return useCallback(() => {
    localStorage.removeItem("access_token");
    localStorage.removeItem("refresh_token");
    localStorage.removeItem("selected_project");
    queryClient.clear();
    router.push("/login");
  }, [queryClient, router]);
}
