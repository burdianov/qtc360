"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useCurrentUser } from "@/hooks/use-auth";
import { useUserProjects, useSelectedProject, useSetProject } from "@/hooks/use-project";
import { ProjectSelectModal } from "@/components/layout/project-select-modal";

export function AuthGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const { data: user, isLoading, isError } = useCurrentUser();
  const { data: projects } = useUserProjects();
  const selectedProject = useSelectedProject();
  const setProject = useSetProject();
  const [showProjectModal, setShowProjectModal] = useState(false);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (mounted && !isLoading && (isError || !user)) {
      const hasToken = localStorage.getItem("access_token");
      if (!hasToken) router.replace("/login");
    }
  }, [mounted, isLoading, isError, user, router]);

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
  if (!user) return null;

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
