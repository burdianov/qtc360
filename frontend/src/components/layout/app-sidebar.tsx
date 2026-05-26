"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { ChevronDown, ChevronLeft, LogOut } from "lucide-react";
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
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { navigation } from "@/config/navigation";
import { cn } from "@/lib/utils";

export function AppSidebar() {
  const pathname = usePathname();
  const { toggleSidebar } = useSidebar();

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
          className="flex items-center h-full w-full pl-4.5"
        >
          {/* Dark theme logos */}
          <Image
            src="/logo-icon.svg"
            alt="QTC360"
            width={28}
            height={28}
            className="shrink-0 hidden dark:group-data-[collapsible=icon]:block"
          />
          <Image
            src="/logo.svg"
            alt="QTC360"
            width={140}
            height={28}
            className="hidden dark:group-data-[collapsible=icon]:hidden dark:block"
            style={{ marginLeft: "-2px" }}
          />
          {/* Light theme logos */}
          <Image
            src="/logo-icon-light.svg"
            alt="QTC360"
            width={28}
            height={28}
            className="shrink-0 group-data-[collapsible=icon]:block hidden dark:hidden"
          />
          <Image
            src="/logo-light.svg"
            alt="QTC360"
            width={140}
            height={28}
            className="group-data-[collapsible=icon]:hidden block dark:hidden"
            style={{ marginLeft: "-2px" }}
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
        {navigation.map((group) => (
          <Collapsible
            key={group.label}
            defaultOpen
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
                            "h-10 text-sidebar-foreground/85 hover:text-white transition-colors duration-150",
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
        ))}
      </SidebarContent>

      {/* Footer */}
      <SidebarFooter className="border-t border-border px-3">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton tooltip="Profile" className="h-10">
              <Avatar className="h-7 w-7">
                <AvatarFallback className="text-xs bg-primary text-primary-foreground">
                  AD
                </AvatarFallback>
              </Avatar>
              <div className="flex flex-col group-data-[collapsible=icon]:hidden">
                <span className="text-sm">Admin</span>
                <span className="text-xs text-muted-foreground">
                  admin@qtc360.com
                </span>
              </div>
              <LogOut className="ml-auto h-4 w-4 text-muted-foreground group-data-[collapsible=icon]:hidden" />
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
