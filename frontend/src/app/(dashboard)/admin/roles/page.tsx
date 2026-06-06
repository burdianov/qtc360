"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Save } from "lucide-react";
import api from "@/lib/api";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Spinner } from "@/components/ui/spinner";
import { Card, CardContent } from "@/components/ui/card";

interface Permission {
  id: string;
  code: string;
  description: string | null;
}
interface RoleItem {
  id: string;
  name: string;
  description: string | null;
  permissions: Permission[];
}

export default function RolesPage() {
  const queryClient = useQueryClient();
  const [changes, setChanges] = useState<Record<string, string[]>>({});

  const { data: roles = [] } = useQuery<RoleItem[]>({
    queryKey: ["admin-roles"],
    queryFn: async () => (await api.get("/admin/roles")).data,
  });

  const { data: permissions = [] } = useQuery<Permission[]>({
    queryKey: ["admin-permissions"],
    queryFn: async () => (await api.get("/admin/permissions")).data,
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      for (const [roleId, permIds] of Object.entries(changes)) {
        await api.patch(`/admin/roles/${roleId}`, { permission_ids: permIds });
      }
    },
    onSuccess: () => {
      toast.success("Permissions saved");
      setChanges({});
      queryClient.invalidateQueries({ queryKey: ["admin-roles"] });
    },
    onError: () => toast.error("Failed to save permissions"),
  });

  const getPermIds = (role: RoleItem): string[] => {
    return changes[role.id] ?? role.permissions.map((p) => p.id);
  };

  const toggle = (role: RoleItem, permId: string) => {
    const current = getPermIds(role);
    const next = current.includes(permId)
      ? current.filter((id) => id !== permId)
      : [...current, permId];
    setChanges({ ...changes, [role.id]: next });
  };

  const hasChanges = Object.keys(changes).length > 0;

  // Group permissions by category
  const groups: Record<string, Permission[]> = {};
  for (const p of permissions) {
    const cat = p.code.split(".")[0];
    if (!groups[cat]) groups[cat] = [];
    groups[cat].push(p);
  }

  const categoryLabels: Record<string, string> = {
    documents: "Documents",
    commissioning: "Commissioning",
    master_data: "Master Data",
    reports: "Reports",
    admin: "Administration",
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Roles & Permissions
          </h1>
          <p className="text-sm text-muted-foreground">
            Manage what each role can access
          </p>
        </div>
        <Button
          onClick={() => saveMutation.mutate()}
          disabled={!hasChanges || saveMutation.isPending}
        >
          <Save className="h-4 w-4 mr-2" />
          {saveMutation.isPending && <Spinner size="sm" className="mr-1 text-current" />}
          {saveMutation.isPending ? "Saving…" : "Save Changes"}
        </Button>
      </div>

      <Card>
        <CardContent className="pt-6 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b">
                <th className="text-left py-2 pr-4 font-medium text-muted-foreground min-w-[200px]">
                  Permission
                </th>
                {roles.map((role) => (
                  <th
                    key={role.id}
                    className="text-center py-2 px-3 font-medium min-w-[100px]"
                  >
                    <div>{role.name.replace(/_/g, " ")}</div>
                    <div className="text-[10px] text-muted-foreground font-normal">
                      {role.description?.split("-")[0]?.trim()}
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {Object.entries(groups).map(([cat, perms]) => (
                <>
                  <tr key={cat}>
                    <td
                      colSpan={roles.length + 1}
                      className="pt-4 pb-1 text-xs font-semibold text-muted-foreground uppercase tracking-wider"
                    >
                      {categoryLabels[cat] || cat}
                    </td>
                  </tr>
                  {perms.map((perm) => (
                    <tr
                      key={perm.id}
                      className="border-b border-border/50 hover:bg-accent/30"
                    >
                      <td className="py-2 pr-4">
                        <div className="font-medium">
                          {perm.code.split(".")[1]?.replace(/_/g, " ")}
                        </div>
                        <div className="text-[10px] text-muted-foreground">
                          {perm.description}
                        </div>
                      </td>
                      {roles.map((role) => (
                        <td key={role.id} className="text-center py-2 px-3">
                          <Checkbox
                            checked={getPermIds(role).includes(perm.id)}
                            onCheckedChange={() => toggle(role, perm.id)}
                            disabled={role.name === "super_admin"}
                          />
                        </td>
                      ))}
                    </tr>
                  ))}
                </>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
