'use client'

import { Ssgoi, type SsgoiConfig } from '@ssgoi/react'
import { axis, drill } from '@ssgoi/react/view-transitions'
import { usePathname } from 'next/navigation'
import { useReducedMotion } from 'motion/react'

const APP_ROUTES = [
  '/dashboard',
  '/inbox',
  '/studio',
  '/studio/workflow',
  '/operations-agents',
  '/sources',
  '/sources/*',
  '/records',
  '/tasks',
  '/schedules',
  '/notifications',
  '/agents',
  '/skills',
  '/providers',
  '/nodes',
  '/workers',
  '/control/actions',
  '/settings',
  '/canvas',
] as const

const APP_ROUTE_TRANSITIONS = [
  drill({ enter: '/studio/workflow', exit: '/studio', type: 'parallax' }),
  drill({ enter: '/sources/*', exit: '/sources', type: 'slide' }),
  axis({ paths: APP_ROUTES, type: 'x', variant: 'snappy' }),
]

const MOTION_CONFIG: SsgoiConfig = { transitions: APP_ROUTE_TRANSITIONS }
const STATIC_CONFIG: SsgoiConfig = { transitions: [] }

/**
 * Keeps the application chrome mounted while SSGOI owns only the routed page.
 * The pathname key intentionally ignores query-only filter changes.
 */
export function AppRouteTransition({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const prefersReducedMotion = useReducedMotion()

  return (
    <Ssgoi config={prefersReducedMotion ? STATIC_CONFIG : MOTION_CONFIG}>
      <div
        key={pathname}
        data-ssgoi-transition={pathname}
        className="min-h-full bg-background"
      >
        {children}
      </div>
    </Ssgoi>
  )
}
