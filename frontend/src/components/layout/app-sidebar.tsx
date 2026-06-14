"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import { ChevronDown, ChevronLeft, ChevronsUpDown, LogOut, Settings, User } from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarFooter,
  useSidebar,
} from "@/components/ui/sidebar";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { navigation } from "@/config/navigation";
import { cn } from "@/lib/utils";
import { useCurrentUser, useLogout } from "@/hooks/use-auth";

export function AppSidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { toggleSidebar } = useSidebar();
  const { data: user } = useCurrentUser();
  const logout = useLogout();
  const initials = user?.full_name?.split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase() || "?";

  const isAdmin = user?.is_superuser || user?.roles?.some((r) => r.name === "admin" || r.name === "super_admin");
  const visibleNavigation = navigation
    .filter((g) => g.label !== "Administration" || isAdmin)
    .map((g) => isAdmin ? g : { ...g, items: g.items.filter((item) => !item.adminOnly) });

  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(visibleNavigation.map((g) => [g.label, true]))
  );

  // Open the group containing the active route on navigation
  useEffect(() => {
    const group = visibleNavigation.find((g) => g.items.some((item) => item.url === pathname));
    if (group && !openGroups[group.label]) {
      setOpenGroups((prev) => ({ ...prev, [group.label]: true }));
    }
    // Scroll after group opens
    const timer = setTimeout(() => {
      const el = document.querySelector<HTMLElement>(`[data-sidebar="menu-button"][data-active]`);
      el?.scrollIntoView({ block: "nearest" });
    }, 200);
    return () => clearTimeout(timer);
  }, [pathname]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Sidebar
      collapsible="icon"
      style={
        {
          "--sidebar-width": "260px",
          "--sidebar-width-icon": "64px",
        } as React.CSSProperties
      }
    >
      {/* Header */}
      <SidebarHeader className="p-0! h-16 flex items-center">
        <Link
          href="/dashboard"
          className="flex items-center h-full w-full pl-4.5 group-data-[collapsible=icon]:pl-0 group-data-[collapsible=icon]:justify-center"
        >
          {/* Dark theme logos */}
          <Image
            src="/logo-icon.svg"
            alt="QTC360"
            width={32}
            height={32}
            className="shrink-0 hidden dark:group-data-[collapsible=icon]:block"
          />
          <Image
            src="/logo.svg"
            alt="QTC360"
            width={140}
            height={28}
            className="hidden dark:group-data-[collapsible=icon]:hidden dark:block"
            style={{ marginLeft: "-2px", height: "auto" }}
          />
          {/* Light theme logos */}
          <Image
            src="/logo-icon-light.svg"
            alt="QTC360"
            width={32}
            height={32}
            className="shrink-0 group-data-[collapsible=icon]:block hidden dark:hidden"
          />
          <Image
            src="/logo-light.svg"
            alt="QTC360"
            width={140}
            height={28}
            className="group-data-[collapsible=icon]:hidden block dark:hidden"
            style={{ marginLeft: "-2px", height: "auto" }}
          />
        </Link>
      </SidebarHeader>

      {/* Chevron toggle */}
      <button
        onClick={toggleSidebar}
        className="absolute -right-3 top-19 z-50 flex h-6 w-6 items-center justify-center rounded-full border border-border bg-background text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
      >
        <ChevronLeft className="h-3 w-3 transition-transform duration-200 group-data-[collapsible=icon]:rotate-180" />
      </button>

      {/* Navigation */}
      <SidebarContent>
        {visibleNavigation.map((group) => {
          return (
          <Collapsible
            key={group.label}
            open={openGroups[group.label]}
            onOpenChange={(open) => setOpenGroups((prev) => ({ ...prev, [group.label]: open }))}
            className="group/collapsible"
          >
            <SidebarGroup className="py-1 px-3">
              <SidebarGroupLabel className="group-data-[collapsible=icon]:hidden px-2 text-[11px] uppercase tracking-wider text-muted-foreground font-medium mb-1">
                <CollapsibleTrigger className="flex w-full items-center justify-between">
                  {group.label}
                  <ChevronDown className="h-3 w-3 transition-transform duration-200 group-data-[state=closed]/collapsible:-rotate-90" />
                </CollapsibleTrigger>
              </SidebarGroupLabel>
              <CollapsibleContent>
                <SidebarMenu className="gap-0.5">
                  {group.items.map((item) => {
                    const isActive = pathname === item.url;
                    return (
                      <SidebarMenuItem key={item.url}>
                        <SidebarMenuButton
                          render={<Link href={item.url} />}
                          isActive={isActive}
                          tooltip={item.title}
                          className={cn(
                            "h-10 text-sidebar-foreground/70 hover:text-sidebar-accent-foreground transition-colors duration-150",
                            isActive &&
                              "text-primary! bg-primary/10 font-medium",
                          )}
                        >
                          <item.icon
                            className={cn(
                              "h-5! w-5!",
                              isActive && "text-primary!",
                            )}
                          />
                          <span>{item.title}</span>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    );
                  })}
                </SidebarMenu>
              </CollapsibleContent>
            </SidebarGroup>
          </Collapsible>
          );
        })}
      </SidebarContent>

      {/* Footer */}
      <SidebarFooter className="border-t border-border py-2 px-3">
        <SidebarMenu>
          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger className="w-full" render={<div />} nativeButton={false}>
                <SidebarMenuButton tooltip={user?.full_name || "Profile"} className="h-10">
                  <div className="flex h-4 w-4 items-center justify-center">
                    <Avatar className="h-7 w-7">
                      <AvatarFallback className="text-xs bg-primary text-primary-foreground">
                        {initials}
                      </AvatarFallback>
                    </Avatar>
                  </div>
                  <div className="flex flex-col ml-1 group-data-[collapsible=icon]:hidden">
                    <span className="text-sm">{user?.full_name || "User"}</span>
                    <span className="text-xs text-muted-foreground">
                      {user?.email || ""}
                    </span>
                  </div>
                  <ChevronsUpDown className="ml-auto h-4 w-4 text-muted-foreground group-data-[collapsible=icon]:hidden" />
                </SidebarMenuButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent side="top" align="start" sideOffset={12} className="w-[var(--anchor-width)]">
                <div className="px-2 py-1.5">
                  <p className="text-sm font-medium">{user?.full_name}</p>
                  <p className="text-xs text-muted-foreground">{user?.email}</p>
                </div>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => router.push("/profile")}><User className="mr-2 h-4 w-4" />Profile</DropdownMenuItem>
                {isAdmin ? <DropdownMenuItem onClick={() => router.push("/admin/settings")}><Settings className="mr-2 h-4 w-4" />Settings</DropdownMenuItem> : null}
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={logout}><LogOut className="mr-2 h-4 w-4" />Log out</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
