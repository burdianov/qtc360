"use client";

import { useCurrentUser } from "@/hooks/use-auth";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const { data: user, isLoading } = useCurrentUser();
  const router = useRouter();

  const isAdmin = user?.is_superuser || user?.roles?.some((r) => r.name === "admin" || r.name === "super_admin");

  useEffect(() => {
    if (!isLoading && user && !isAdmin) {
      router.replace("/dashboard");
    }
  }, [isLoading, user, isAdmin, router]);

  if (isLoading) return <div className="p-6">Loading...</div>;
  if (!isAdmin) return null;

  return <>{children}</>;
}
