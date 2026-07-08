'use client'

import { useRouter } from 'next/navigation'
import { useEffect } from 'react'

import { NAV_GROUPS } from '@/lib/navigation'
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@/components/ui/command'

export function CommandPalette({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const router = useRouter()

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        onOpenChange(!open)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, onOpenChange])

  const go = (href: string) => {
    onOpenChange(false)
    router.push(href)
  }

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput placeholder="搜索页面、跳转…" />
      <CommandList>
        <CommandEmpty>没有匹配结果。</CommandEmpty>
        {NAV_GROUPS.map((group, i) => (
          <div key={group.label ?? `g-${i}`}>
            {i > 0 ? <CommandSeparator /> : null}
            <CommandGroup heading={group.label ?? '导航'}>
              {group.items.map((item) => {
                const Icon = item.icon
                return (
                  <CommandItem key={item.href} value={item.label} onSelect={() => go(item.href)}>
                    <Icon />
                    <span>{item.label}</span>
                  </CommandItem>
                )
              })}
            </CommandGroup>
          </div>
        ))}
      </CommandList>
    </CommandDialog>
  )
}
