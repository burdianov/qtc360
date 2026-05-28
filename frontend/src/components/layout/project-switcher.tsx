"use client";

import { useRouter } from "next/navigation";
import { ChevronsUpDown, FolderKanban } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useUserProjects, useSelectedProject, useSetProject } from "@/hooks/use-project";

export function ProjectSwitcher({ mobile }: { mobile?: boolean }) {
  const router = useRouter();
  const { data: projects } = useUserProjects();
  const selectedProject = useSelectedProject();
  const setProject = useSetProject();

  if (!selectedProject) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={
          mobile
            ? "flex items-center gap-1.5 text-sm"
            : "hidden md:flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-sm hover:bg-accent transition-colors"
        }
      >
        <FolderKanban className="h-3.5 w-3.5 text-primary" />
        <span className="font-medium">{selectedProject.name}</span>
        <span className="text-muted-foreground">({selectedProject.code})</span>
        <ChevronsUpDown className="h-3 w-3 text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align={mobile ? "center" : "end"} className="w-52">
        {projects?.map((project) => (
          <DropdownMenuItem
            key={project.id}
            onClick={() => { setProject(project); if (project.id !== selectedProject.id) router.replace("/dashboard"); }}
            className={project.id === selectedProject.id ? "bg-accent" : ""}
          >
            <FolderKanban className="mr-2 h-4 w-4" />
            <div>
              <p className="text-sm">{project.name}</p>
              <p className="text-xs text-muted-foreground">{project.code}</p>
            </div>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
