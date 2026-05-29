"use client";

import { useState, useEffect } from "react";
import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { Navbar } from "@/components/layout/navbar";
import { CommandPalette } from "@/components/layout/command-palette";
import { AuthGuard } from "@/components/providers/auth-guard";
import api from "@/lib/api";
import { setDateFormat } from "@/lib/format-date";

function getInitialOpen(): boolean {
  if (typeof window === "undefined") return true;
  // Read cookie
  const match = document.cookie.match(/sidebar_state=(\w+)/);
  if (match) return match[1] === "true";
  return true;
}

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [commandOpen, setCommandOpen] = useState(false);
  const [open, setOpen] = useState(getInitialOpen);

  // Auto-collapse on tablet, expand on desktop
  useEffect(() => {
    const tablet = window.matchMedia("(min-width: 768px) and (max-width: 1023px)");
    const handleChange = () => setOpen(!tablet.matches);
    handleChange();
    tablet.addEventListener("change", handleChange);
    return () => tablet.removeEventListener("change", handleChange);
  }, []);

  useEffect(() => {
    document.cookie = `sidebar_state=${open}; path=/; max-age=${60 * 60 * 24 * 7}`;
  }, [open]);

  useEffect(() => {
    api.get("/admin/settings/date_format").then((res) => {
      if (res.data?.value) setDateFormat(res.data.value);
    }).catch(() => {});
  }, []);

  return (
    <AuthGuard>
      <SidebarProvider open={open} onOpenChange={setOpen}>
        <AppSidebar />
        <SidebarInset>
          <Navbar onSearchClick={() => setCommandOpen(true)} />
          <main className="flex-1 overflow-x-hidden p-6">{children}</main>
        </SidebarInset>
        <CommandPalette open={commandOpen} onOpenChange={setCommandOpen} />
      </SidebarProvider>
    </AuthGuard>
  );
}
