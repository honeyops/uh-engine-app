"use client"

import * as React from "react"
import Image from "next/image"
import Link from "next/link"
import { usePathname } from "next/navigation"
import {
  ArrowLeftToLine,
  ArrowRightToLine,
  Cog,
  Database,
  DatabaseZap,
  FileText,
  Gauge,
  GitBranch,
  Home,
  Layers,
  LifeBuoy,
  Network,
  ShieldCheck,
  Workflow,
} from "lucide-react"

import { NavMain } from "@/components/nav-main"
import { NavSecondary } from "@/components/nav-secondary"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarSeparator,
  useSidebar,
} from "@/components/ui/sidebar"
import versionInfo from "@/version.json"

const data = {
  modelling: [
    {
      title: "Model Catalog",
      url: "/model-catalog",
      icon: Layers,
    },
    {
      title: "Source Access",
      url: "/source-access",
      icon: DatabaseZap,
      isHidden: true,
    },
    {
      title: "Source Mapping",
      url: "/source-mapping",
      icon: Workflow,
      isHidden: true,
    },
    {
      title: "Governance",
      url: "/governance",
      icon: ShieldCheck,
      isHidden: true,
    },
  ],
  timeseries: [
    {
      title: "Engine",
      url: "/engine",
      icon: Cog,
    },
    {
      title: "Rules",
      url: "/rules",
      icon: FileText,
    },
    {
      title: "Clustering",
      url: "/clustering",
      icon: Network,
      isHidden: true,
    },
    {
      title: "Database",
      url: "/timeseries-database",
      icon: Database,
    },
  ],
  footer: [
    {
      title: "Support",
      url: "/support",
      icon: LifeBuoy,
    },
  ],
}

const sidebarVersionLabel = (() => {
  const version = versionInfo.version?.trim()
  if (!version) {
    return "v0.0.0"
  }
  return version.startsWith("v") ? version : `v${version}`
})()

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  const { state, toggleSidebar } = useSidebar()
  const pathname = usePathname()
  const isHomeActive = pathname === "/"
  
  return (
    <Sidebar variant="inset" collapsible="icon" {...props}>
      <SidebarHeader className={cn("text-sidebar-foreground", state === "expanded" && "mt-2.5")}>
        {/* Expanded State: Logo left, arrow right */}
        <div
          className={cn(
            "flex w-full items-center justify-between transition-opacity duration-200 ease-in-out",
            state === "expanded" ? "opacity-100 relative" : "absolute opacity-0 pointer-events-none"
          )}
        >
          <Image
            src="/logo_full.svg"
            alt="Unified Honey"
            width={120}
            height={36}
            priority
            className="h-8 w-auto"
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Collapse sidebar"
            onClick={toggleSidebar}
            className="h-8 w-8 rounded-md hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring"
          >
            <ArrowLeftToLine className="h-4 w-4" />
          </Button>
        </div>

        {/* Collapsed State: Logo above arrow */}
        <div
          className={cn(
            "relative flex w-full min-w-0 flex-col items-center gap-2 p-2 transition-opacity duration-200 ease-in-out",                                         
            state === "collapsed" ? "opacity-100" : "absolute opacity-0 pointer-events-none"                                                                    
          )}
        >
          <div className="flex flex-1 items-center justify-center size-8 p-[4px]">
            <Image
              src="/logo_mark.svg"
              alt="Unified Honey"
              width={32}
              height={32}
              priority
              className="size-8 object-contain"
            />
          </div>
          <button
            type="button"
            aria-label="Expand sidebar"
            onClick={toggleSidebar}
            className="flex size-8 shrink-0 items-center justify-center rounded-md p-2 text-sidebar-foreground outline-none ring-sidebar-ring transition-[width,height,padding] hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 active:bg-sidebar-accent active:text-sidebar-accent-foreground disabled:pointer-events-none disabled:opacity-50"                                       
          >
            <ArrowRightToLine className="h-4 w-4 shrink-0" />
          </button>
        </div>
      </SidebarHeader>
      <SidebarContent className="pt-[5px]">
        <SidebarGroup>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton asChild tooltip="Home" isActive={isHomeActive}>
                <Link href="/">
                  <Home />
                  <span>Home</span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarGroup>
        <SidebarGroup>
          <SidebarGroupLabel>Ingestion</SidebarGroupLabel>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton asChild tooltip="Openflow" isActive={pathname === "/openflow"}>
                <Link href="/openflow">
                  <GitBranch />
                  <span>Openflow</span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarGroup>
        {state === "collapsed" && (
          <div className="w-8 mx-auto">
            <SidebarSeparator />
          </div>
        )}
        <NavMain items={data.modelling} label="Modelling" />
        {state === "collapsed" && (
          <div className="w-8 mx-auto">
            <SidebarSeparator />
          </div>
        )}
        <NavSecondary items={data.timeseries} label="Timeseries" />
      </SidebarContent>
      <SidebarFooter className="mt-auto p-0">
        <SidebarGroup>
          <div className="flex h-8 shrink-0 items-center px-2 transition-[margin,opacity] duration-200 ease-linear group-data-[collapsible=icon]:-mt-8 group-data-[collapsible=icon]:opacity-0" aria-hidden="true" />
          <SidebarMenu>
            {data.footer.map((item) => {
              const isActive = pathname === item.url
              return (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton asChild tooltip={item.title} isActive={isActive}>
                    <Link href={item.url}>
                      <item.icon />
                      <span>{item.title}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              )
            })}
          </SidebarMenu>
        </SidebarGroup>
        <div className="px-3 py-1">
          <p className="font-mono text-xs font-semibold text-sidebar-foreground/40 group-data-[collapsible=icon]:text-[10px] group-data-[collapsible=icon]:text-center">
            {sidebarVersionLabel}
          </p>
        </div>
      </SidebarFooter>
    </Sidebar>
  )
}
