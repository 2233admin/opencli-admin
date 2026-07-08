'use client'

import { Search } from 'lucide-react'
import { usePathname } from 'next/navigation'

import { ROUTE_LABELS } from '@/lib/navigation'
import { Button } from '@/components/ui/button'
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb'
import { Kbd, KbdGroup } from '@/components/ui/kbd'
import { Separator } from '@/components/ui/separator'
import { SidebarTrigger } from '@/components/ui/sidebar'
import { ThemeToggle } from '@/components/shell/theme-toggle'

function resolveLabel(pathname: string): string | null {
  if (ROUTE_LABELS[pathname]) return ROUTE_LABELS[pathname]
  if (pathname.startsWith('/canvas')) return '采集画布'
  const match = Object.keys(ROUTE_LABELS).find((href) => pathname.startsWith(`${href}/`))
  return match ? ROUTE_LABELS[match] : null
}

export function AppHeader({ onOpenCommand }: { onOpenCommand?: () => void }) {
  const pathname = usePathname()
  const label = resolveLabel(pathname)

  return (
    <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-2 border-b bg-background/95 px-3 backdrop-blur supports-[backdrop-filter]:bg-background/80">
      <SidebarTrigger />
      <Separator orientation="vertical" className="mr-1 h-5" />
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbPage className="text-muted-foreground">主页</BreadcrumbPage>
          </BreadcrumbItem>
          {label ? (
            <>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                <BreadcrumbPage>{label}</BreadcrumbPage>
              </BreadcrumbItem>
            </>
          ) : null}
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
      </div>
    </header>
  )
}
