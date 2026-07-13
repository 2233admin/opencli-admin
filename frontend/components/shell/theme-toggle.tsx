'use client'

import { Moon, Sun } from 'lucide-react'
import { useTheme } from 'next-themes'
import { startTransition, useEffect, useState } from 'react'

import { LocalViewTransition } from '@/components/motion/local-view-transition'
import { Button } from '@/components/ui/button'

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme()
  const [mounted, setMounted] = useState(false)

  useEffect(() => setMounted(true), [])

  const isDark = resolvedTheme === 'dark'

  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label="切换主题"
      onClick={() => startTransition(() => setTheme(isDark ? 'light' : 'dark'))}
    >
      <LocalViewTransition name="theme-icon">
        <span className="grid size-4 place-items-center" aria-hidden>
          {mounted && isDark ? <Sun /> : <Moon />}
        </span>
      </LocalViewTransition>
    </Button>
  )
}
