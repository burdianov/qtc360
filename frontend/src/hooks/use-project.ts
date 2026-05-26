"use client";

import { useQuery } from "@tanstack/react-query";
import { useCallback, useSyncExternalStore } from "react";
import api from "@/lib/api";

export interface Project {
  id: string;
  name: string;
  code: string;
}

// Simple localStorage-backed store for selected project
const STORAGE_KEY = "selected_project";

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
  return useSyncExternalStore(subscribe, getSnapshot, serverSnapshot);
}

export function useSetProject() {
  return useCallback((project: Project) => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(project));
    window.dispatchEvent(new Event("project-changed"));
  }, []);
}

export function useUserProjects() {
  return useQuery<Project[]>({
    queryKey: ["auth", "projects"],
    queryFn: async () => (await api.get("/auth/me/projects")).data,
    enabled: typeof window !== "undefined" && !!localStorage.getItem("access_token"),
  });
}
