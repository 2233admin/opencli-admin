'use client'

import { ViewTransition } from 'react'

const VIEW_TRANSITIONS_ENABLED = process.env.NEXT_PUBLIC_ENABLE_VIEW_TRANSITIONS !== 'false'

/**
 * Opt-in boundary for local shared elements outside the SSGOI route surface.
 * Unsupported browsers and the feature-flag-off path render identical markup.
 */
export function LocalViewTransition({
  children,
  name,
}: {
  children: React.ReactNode
  name: string
}) {
  if (!VIEW_TRANSITIONS_ENABLED) return children
  return <ViewTransition name={name}>{children}</ViewTransition>
}
