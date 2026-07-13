'use client'

import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import { motion } from 'motion/react'

import { NAV_GROUPS, type NavItem } from '@/lib/navigation'
import { Ripple } from '@/components/motion/ripple'
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from '@/components/ui/sidebar'

function isActivePath(pathname: string, searchParams: URLSearchParams, item: NavItem) {
  const itemPath = item.href.split('?')[0]
  const prefixes = item.match ?? [itemPath]
  const pathMatches = itemPath === '/dashboard'
    ? pathname === itemPath
    : prefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))

  if (!pathMatches) return false
  if (item.query && !Object.entries(item.query).every(([key, value]) => (
    value === null ? !searchParams.has(key) : searchParams.get(key) === value
  ))) return false
  if (item.excludeQuery && Object.entries(item.excludeQuery).some(([key, value]) => (
    searchParams.get(key) === value
  ))) return false
  return true
}

export function AppSidebar() {
  const pathname = usePathname()
  const searchParams = useSearchParams()

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <div className="flex items-center gap-2.5 px-1.5 py-1">
          <span className="grid size-8 shrink-0 place-items-center rounded-md bg-primary font-mono text-xs font-bold tracking-tight text-primary-foreground">
            OC
          </span>
          <div className="flex min-w-0 flex-col group-data-[collapsible=icon]:hidden">
            <span className="truncate text-sm font-semibold leading-tight">OpenCLI</span>
            <span className="truncate text-xs text-muted-foreground leading-tight">数据节点执行 IDE</span>
          </div>
        </div>
      </SidebarHeader>

      <SidebarContent>
        {NAV_GROUPS.map((group, groupIndex) => (
          <SidebarGroup key={group.label ?? `group-${groupIndex}`} className="py-1">
            {group.label ? <SidebarGroupLabel className="h-7 px-2 text-[10px] tracking-wide">{group.label}</SidebarGroupLabel> : null}
            <SidebarGroupContent>
              <SidebarMenu>
                {group.items.map((item) => {
                  const active = isActivePath(pathname, searchParams, item)
                  const Icon = item.icon
                  return (
                    <SidebarMenuItem key={item.href}>
                      <SidebarMenuButton
                        isActive={active}
                        tooltip={item.label}
                        className="relative h-8 overflow-hidden text-[13px]"
                        render={<Link href={item.href} />}
                      >
                        {active ? (
                          <motion.span
                            layoutId="sidebar-active-telemetry"
                            aria-hidden="true"
                            className="nav-telemetry-rail absolute inset-y-1.5 left-0.5 w-0.5"
                            transition={{ type: 'spring', stiffness: 520, damping: 42, mass: 0.55 }}
                          />
                        ) : null}
                        <Icon />
                        <span className="flex-1 truncate">{item.label}</span>
                        <Ripple />
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  )
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>

      <SidebarRail />
    </Sidebar>
  )
}
