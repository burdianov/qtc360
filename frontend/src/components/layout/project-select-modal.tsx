"use client";

import { FolderKanban } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { type Project, useUserProjects, useSetProject } from "@/hooks/use-project";

interface ProjectSelectModalProps {
  open: boolean;
  onSelect: (project: Project) => void;
}

export function ProjectSelectModal({ open, onSelect }: ProjectSelectModalProps) {
  const { data: projects } = useUserProjects();
  const setProject = useSetProject();

  const handleSelect = (project: Project) => {
    setProject(project);
    onSelect(project);
  };

  return (
    <Dialog open={open}>
      <DialogContent className="sm:max-w-md" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Select Project</DialogTitle>
        </DialogHeader>
        <div className="grid gap-2 py-2">
          {projects?.map((project) => (
            <button
              key={project.id}
              onClick={() => handleSelect(project)}
              className="flex items-center gap-3 rounded-lg border border-border p-4 text-left transition-colors hover:bg-accent"
            >
              <FolderKanban className="h-5 w-5 text-muted-foreground" />
              <div>
                <p className="font-medium">{project.name}</p>
                <p className="text-sm text-muted-foreground">{project.code}</p>
              </div>
            </button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
