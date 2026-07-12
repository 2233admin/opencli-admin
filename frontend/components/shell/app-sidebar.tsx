'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

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

function isActivePath(pathname: string, item: NavItem) {
  const prefixes = item.match ?? [item.href]
  if (item.href === '/dashboard') return pathname === item.href
  return prefixes.some((p) => pathname === p || pathname.startsWith(`${p}/`))
}

export function AppSidebar() {
  const pathname = usePathname()

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
                  const active = isActivePath(pathname, item)
                  const Icon = item.icon
                  return (
                    <SidebarMenuItem key={item.href}>
                      <SidebarMenuButton
                        isActive={active}
                        tooltip={item.label}
                        className="relative h-8 overflow-hidden text-[13px]"
                        render={<Link href={item.href} />}
                      >
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
