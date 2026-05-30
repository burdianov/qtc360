"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useSyncExternalStore } from "react";
import api from "@/lib/api";
import { STORAGE_KEYS } from "@/lib/constants";

export interface Project {
  id: string;
  name: string;
  code: string;
}

// Simple localStorage-backed store for selected project
const STORAGE_KEY = STORAGE_KEYS.SELECTED_PROJECT;

let cachedProject: Project | null = null;
let cachedRaw: string | null = null;

function getSnapshot(): Project | null {
  if (typeof window === "undefined") return null;
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    cachedProject = raw ? JSON.parse(raw) : null;
  }
  return cachedProject;
}

const serverSnapshot = () => null;

function subscribe(callback: () => void) {
  window.addEventListener("storage", callback);
  window.addEventListener("project-changed", callback);
  return () => {
    window.removeEventListener("storage", callback);
    window.removeEventListener("project-changed", callback);
  };
}

export function useSelectedProject() {
  const project = useSyncExternalStore(subscribe, getSnapshot, serverSnapshot);
  const { data: projects } = useQuery<Project[]>({
    queryKey: ["auth", "projects"],
    queryFn: async () => (await api.get("/auth/me/projects")).data,
    enabled: typeof window !== "undefined" && !!localStorage.getItem(STORAGE_KEYS.ACCESS_TOKEN),
  });

  // Auto-fix stale project: if cached project ID doesn't match any user project, select first
  useEffect(() => {
    if (!projects || projects.length === 0) return;
    if (!project || !projects.find((p) => p.id === project.id)) {
      const first = projects[0];
      localStorage.setItem(STORAGE_KEY, JSON.stringify(first));
      window.dispatchEvent(new Event("project-changed"));
    }
  }, [projects, project]);

  return project;
}

export function useSetProject() {
  const queryClient = useQueryClient();
  return useCallback(
    (project: Project) => {
      const prevRaw = localStorage.getItem(STORAGE_KEY);
      const prev = prevRaw ? (JSON.parse(prevRaw) as Project) : null;
      if (prev?.id === project.id) return;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(project));
      window.dispatchEvent(new Event("project-changed"));
      // Drop project-scoped caches so the new project doesn't render with the
      // previous project's data. Auth/projects/user data stays.
      queryClient.removeQueries({
        predicate: (q) => {
          const k = q.queryKey?.[0];
          return k !== "auth";
        },
      });
    },
    [queryClient],
  );
}

export function useUserProjects() {
  return useQuery<Project[]>({
    queryKey: ["auth", "projects"],
    queryFn: async () => (await api.get("/auth/me/projects")).data,
    enabled: typeof window !== "undefined" && !!localStorage.getItem(STORAGE_KEYS.ACCESS_TOKEN),
  });
}
