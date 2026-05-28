"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useCurrentUser } from "@/hooks/use-auth";
import { useUserProjects, useSelectedProject, useSetProject } from "@/hooks/use-project";
import { ProjectSelectModal } from "@/components/layout/project-select-modal";
import type { AxiosError } from "axios";

export function AuthGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const { data: user, isLoading, isError, error, refetch } = useCurrentUser();
  const { data: projects } = useUserProjects();
  const selectedProject = useSelectedProject();
  const setProject = useSetProject();
  const [showProjectModal, setShowProjectModal] = useState(false);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!mounted || isLoading) return;
    if (!isError && user) return;
    const status = (error as AxiosError | undefined)?.response?.status;
    const hasToken = typeof window !== "undefined" && !!localStorage.getItem("access_token");
    // No token → straight to /login. Otherwise an explicit auth failure routes too.
    if (!hasToken || status === 401 || status === 403) {
      router.replace("/login");
    }
    // Network errors / 5xx fall through to the retry UI below.
  }, [mounted, isLoading, isError, user, error, router]);

  // Show project selection if user has projects but none selected
  useEffect(() => {
    if (!projects || !user) return;
    if (projects.length === 1 && !selectedProject) {
      setProject(projects[0]);
    } else if (projects.length > 1 && !selectedProject) {
      setShowProjectModal(true);
    }
  }, [projects, user, selectedProject, setProject]);

  if (!mounted || isLoading) return null;
  if (!user) {
    const status = (error as AxiosError | undefined)?.response?.status;
    if (isError && status !== 401 && status !== 403 && typeof window !== "undefined" && localStorage.getItem("access_token")) {
      return (
        <div className="flex min-h-screen items-center justify-center p-6">
          <div className="max-w-sm space-y-3 text-center">
            <h2 className="text-lg font-medium">Couldn't reach the server</h2>
            <p className="text-sm text-muted-foreground">
              Check your connection and try again.
            </p>
            <button
              type="button"
              onClick={() => refetch()}
              className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-accent"
            >
              Retry
            </button>
          </div>
        </div>
      );
    }
    return null;
  }

  return (
    <>
      {children}
      <ProjectSelectModal
        open={showProjectModal}
        onSelect={() => setShowProjectModal(false)}
      />
    </>
  );
}
