'use client'

import { LogOut, Search } from 'lucide-react'
import { usePathname, useRouter } from 'next/navigation'
import { Fragment } from 'react'

import { useAuth } from '@/components/auth/auth-provider'
import { ROUTE_LABELS } from '@/lib/navigation'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb'
import { Kbd, KbdGroup } from '@/components/ui/kbd'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Separator } from '@/components/ui/separator'
import { SidebarTrigger } from '@/components/ui/sidebar'
import { ThemeToggle } from '@/components/shell/theme-toggle'

function resolveLabels(pathname: string): string[] {
  if (pathname.startsWith('/studio/workflow')) return ['工作区', '节点工作流']
  if (ROUTE_LABELS[pathname]) return [ROUTE_LABELS[pathname]]
  const match = Object.keys(ROUTE_LABELS).find((href) => pathname.startsWith(`${href}/`))
  return match ? [ROUTE_LABELS[match]] : []
}
export function AppHeader({ onOpenCommand }: { onOpenCommand?: () => void }) {
  const pathname = usePathname()
  const router = useRouter()
  const { identity, signOut } = useAuth()
  const labels = resolveLabels(pathname)
  const displayName = identity?.name || identity?.email || identity?.subject || 'User'
  const initials = displayName.slice(0, 2).toUpperCase()

  async function handleSignOut() {
    await signOut()
    router.replace('/login')
  }

  return (
    <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-2 border-b bg-background/95 px-3 backdrop-blur supports-[backdrop-filter]:bg-background/80">
      <SidebarTrigger />
      <Separator orientation="vertical" className="mr-1 h-5" />
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbPage className="text-muted-foreground">主页</BreadcrumbPage>
          </BreadcrumbItem>
          {labels.map((label) => (
            <Fragment key={label}>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                <BreadcrumbPage>{label}</BreadcrumbPage>
              </BreadcrumbItem>
            </Fragment>
          ))}
        </BreadcrumbList>
      </Breadcrumb>

      <div className="ml-auto flex items-center gap-1.5">
        <Button
          variant="outline"
          size="sm"
          className="hidden gap-2 text-muted-foreground sm:flex"
          onClick={onOpenCommand}
        >
          <Search />
          <span>搜索…</span>
          <KbdGroup className="ml-2">
            <Kbd>⌘</Kbd>
            <Kbd>K</Kbd>
          </KbdGroup>
        </Button>
        <Button variant="ghost" size="icon" className="sm:hidden" aria-label="搜索" onClick={onOpenCommand}>
          <Search />
        </Button>
        <ThemeToggle />
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button variant="ghost" size="icon" className="rounded-full" aria-label="账号菜单" />
            }
          >
            <Avatar className="size-7">
              <AvatarFallback className="text-[10px]">{initials}</AvatarFallback>
            </Avatar>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuGroup>
              <DropdownMenuLabel className="font-normal">
                <span className="block truncate text-sm font-medium text-foreground">{displayName}</span>
                <span className="block truncate text-xs">
                  {identity?.is_platform_admin ? 'Platform Admin' : identity?.auth_method}
                </span>
              </DropdownMenuLabel>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={handleSignOut}>
              <LogOut />
              退出登录
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  )
}
