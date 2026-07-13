'use client'

import { Ssgoi, type SsgoiConfig } from '@ssgoi/react'
import { axis, drill } from '@ssgoi/react/view-transitions'
import { useReducedMotion } from 'motion/react'
import { usePathname } from 'next/navigation'

const APP_ROUTES = [
  '/dashboard',
  '/studio',
  '/studio/workflow',
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
  '/canvas',
] as const

const MOTION_CONFIG: SsgoiConfig = {
  transitions: [
    drill({ enter: '/studio/workflow', exit: '/studio', type: 'parallax' }),
    drill({ enter: '/sources/*', exit: '/sources', type: 'slide' }),
    axis({ paths: APP_ROUTES, type: 'x', variant: 'snappy' }),
  ],
}

const STATIC_CONFIG: SsgoiConfig = { transitions: [] }

/** Keeps persistent application chrome outside the routed animation boundary. */
export function AppRouteTransition({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const prefersReducedMotion = useReducedMotion()

  return (
    <Ssgoi config={prefersReducedMotion ? STATIC_CONFIG : MOTION_CONFIG}>
      <div key={pathname} data-ssgoi-transition={pathname} className="h-full min-h-full bg-background">
        {children}
      </div>
    </Ssgoi>
  )
}
