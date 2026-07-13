'use client'

import Link from 'next/link'
import { motion } from 'motion/react'
import { usePathname } from 'next/navigation'

import { CREATE_WORK_ITEM, NAV_GROUPS, type NavItem } from '@/lib/navigation'
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
  useSidebar,
} from '@/components/ui/sidebar'

function isActivePath(pathname: string, item: NavItem) {
  const prefixes = item.match ?? [item.href]
  if (item.href === '/dashboard') return pathname === item.href
  return prefixes.some((p) => pathname === p || pathname.startsWith(`${p}/`))
}

export function AppSidebar() {
  const pathname = usePathname()
  const { isMobile, setOpenMobile } = useSidebar()

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <div className="flex items-center gap-2.5 px-1.5 py-1.5">
          <span className="grid size-8 shrink-0 place-items-center rounded-md bg-primary font-mono text-xs font-bold tracking-tight text-primary-foreground">
            OC
          </span>
          <div className="flex min-w-0 flex-col group-data-[collapsible=icon]:hidden">
            <span className="truncate text-sm font-semibold leading-tight">OpenCLI</span>
            <span className="truncate text-xs text-muted-foreground leading-tight">工作与执行控制台</span>
          </div>
        </div>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              tooltip={CREATE_WORK_ITEM.label}
              size="lg"
              className="bg-primary text-primary-foreground shadow-sm hover:bg-primary/90 hover:text-primary-foreground active:bg-primary/85 active:text-primary-foreground"
              render={<Link href={CREATE_WORK_ITEM.href} />}
              onClick={() => {
                if (isMobile) setOpenMobile(false)
              }}
            >
              <CREATE_WORK_ITEM.icon />
              <span className="flex-1 truncate font-semibold">{CREATE_WORK_ITEM.label}</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        {NAV_GROUPS.map((group, groupIndex) => (
          <SidebarGroup key={group.label ?? `group-${groupIndex}`}>
            {group.label ? <SidebarGroupLabel>{group.label}</SidebarGroupLabel> : null}
            <SidebarGroupContent>
              <SidebarMenu>
                {group.items.map((item) => {
                  const active = isActivePath(pathname, item)
                  const Icon = item.icon
                  return (
                    <SidebarMenuItem key={item.href}>
                      <SidebarMenuButton
                        isActive={active}
                        tooltip={item.label}
                        className="relative overflow-hidden"
                        render={<Link href={item.href} />}
                        onClick={() => {
                          if (isMobile) setOpenMobile(false)
                        }}
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
