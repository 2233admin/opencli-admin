'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { motion } from 'motion/react'

import { Ripple } from '@/components/motion/ripple'
import { cn } from '@/lib/utils'

export type RouteTab = { href: string; label: string; exact?: boolean }

/**
 * M3-style segmented route tabs linking sibling views (e.g. 任务/记录/通知).
 * The active pill slides between tabs via a shared layout animation.
 */
export function RouteTabs({ tabs, className }: { tabs: RouteTab[]; className?: string }) {
  const pathname = usePathname()

  return (
    <nav
      aria-label="相关视图"
      className={cn(
        'inline-flex w-fit items-center gap-1 rounded-full bg-muted p-1',
        className,
      )}
    >
      {tabs.map((tab) => {
        const active = tab.exact
          ? pathname === tab.href
          : pathname === tab.href || pathname.startsWith(`${tab.href}/`)
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'relative overflow-hidden rounded-full px-4 py-1.5 text-sm font-medium transition-colors',
              active ? 'text-primary-foreground' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {active ? (
              <motion.span
                layoutId="route-tab-pill"
                className="absolute inset-0 rounded-full bg-primary"
                transition={{ type: 'spring', stiffness: 460, damping: 38, mass: 0.6 }}
              />
            ) : null}
            <span className="relative">{tab.label}</span>
            <Ripple />
          </Link>
        )
      })}
    </nav>
  )
}

/** Shared tab sets for related views. */
export const ACTION_CENTER_TABS: RouteTab[] = [
  { href: '/inbox', label: '待处理' },
  { href: '/tasks', label: '工作项' },
  { href: '/notifications', label: '通知规则' },
]

export const AUTOMATION_TABS: RouteTab[] = [
  { href: '/sources', label: '数据源' },
  { href: '/schedules', label: '调度' },
  { href: '/agents', label: 'Agent' },
  { href: '/skills', label: '技能' },
]

export const DATA_EXPLORER_TABS: RouteTab[] = [
  { href: '/records', label: '数据表', exact: true },
  { href: '/records/graph', label: '关系图谱' },
]

export const COMPUTE_TABS: RouteTab[] = [
  { href: '/nodes', label: '浏览器节点' },
  { href: '/workers', label: 'Worker' },
]

export const MODEL_SETTINGS_TABS: RouteTab[] = [
  { href: '/providers', label: '快速设置', exact: true },
  { href: '/providers/catalog', label: 'Provider 目录' },
]
