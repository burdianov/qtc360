"use client";

import { Bell, Menu, Moon, Search, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { useSidebar } from "@/components/ui/sidebar";
import { ProjectSwitcher } from "@/components/layout/project-switcher";
import api from "@/lib/api";

interface NavbarProps {
  onSearchClick: () => void;
}

function ThemeToggle() {
  const { setTheme, theme } = useTheme();

  return (
    <Button
      variant="ghost"
      size="icon"
      className="h-8 w-8"
      onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
    >
      <Sun className="h-4 w-4 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
      <Moon className="absolute h-4 w-4 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
      <span className="sr-only">Toggle theme</span>
    </Button>
  );
}

export function Navbar({ onSearchClick }: NavbarProps) {
  const { toggleSidebar } = useSidebar();
  const router = useRouter();
  const { data: unreadData } = useQuery<{ count: number }>({
    queryKey: ["notifications", "unread-count"],
    queryFn: async () => (await api.get("/notifications/unread-count")).data,
    refetchInterval: 30000,
  });

  return (
    <header className="flex h-16 shrink-0 items-center border-b border-border px-4 md:px-6 gap-3">
      {/* Mobile: hamburger */}
      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8 md:hidden"
        onClick={toggleSidebar}
      >
        <Menu className="h-5 w-5" />
        <span className="sr-only">Toggle menu</span>
      </Button>

      {/* Mobile: logo left, project right */}
      <Image
        src="/logo.svg"
        alt="QTC360"
        width={100}
        height={22}
        className="hidden dark:block dark:md:hidden shrink-0"
        style={{ height: "auto" }}
      />
      <Image
        src="/logo-light.svg"
        alt="QTC360"
        width={100}
        height={22}
        className="block md:hidden dark:hidden shrink-0"
        style={{ height: "auto" }}
      />
      <div className="flex-1 md:hidden" />
      <div className="md:hidden">
        <ProjectSwitcher mobile />
      </div>

      {/* Desktop: search */}
      <button
        onClick={onSearchClick}
        className="hidden md:flex h-9 w-full max-w-sm items-center gap-2 rounded-md border border-input bg-transparent px-3 text-sm text-muted-foreground hover:bg-accent/50 transition-colors"
      >
        <Search className="h-4 w-4" />
        <span>Search anything...</span>
        <kbd className="ml-auto pointer-events-none hidden h-5 select-none items-center gap-1 rounded border border-border bg-muted px-1.5 font-mono text-[10px] font-medium text-muted-foreground sm:flex">
          <span className="text-xs">⌘</span>K
        </kbd>
      </button>

      {/* Right side actions */}
      <div className="flex items-center gap-2 md:ml-auto">
        <div className="flex items-center gap-1">
        <ThemeToggle />

        <Button variant="ghost" size="icon" className="relative h-8 w-8" onClick={() => router.push("/notifications")}>
          <Bell className="h-4 w-4" />
          {(unreadData?.count ?? 0) > 0 && (
            <span className="absolute -top-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-primary text-[10px] font-medium text-primary-foreground">
              {unreadData!.count > 9 ? "9+" : unreadData!.count}
            </span>
          )}
          <span className="sr-only">Notifications</span>
        </Button>
        </div>

        <ProjectSwitcher />
      </div>
    </header>
  );
}
