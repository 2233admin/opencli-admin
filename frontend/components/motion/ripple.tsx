'use client'

import { useEffect, useRef } from 'react'

/**
 * Material 3 ripple (state layer). Drop inside any relatively-positioned
 * interactive element; it attaches to the parent and spawns expanding
 * circles from the pointer position.
 */
export function Ripple({ className }: { className?: string }) {
  const hostRef = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    const host = hostRef.current
    const parent = host?.parentElement
    if (!host || !parent) return

    if (getComputedStyle(parent).position === 'static') {
      parent.style.position = 'relative'
    }

    const onPointerDown = (e: PointerEvent) => {
      const rect = parent.getBoundingClientRect()
      const x = e.clientX - rect.left
      const y = e.clientY - rect.top
      const radius = Math.hypot(Math.max(x, rect.width - x), Math.max(y, rect.height - y))

      const circle = document.createElement('span')
      circle.className = 'm3-ripple-circle'
      circle.style.left = `${x - radius}px`
      circle.style.top = `${y - radius}px`
      circle.style.width = circle.style.height = `${radius * 2}px`
      host.appendChild(circle)
      circle.addEventListener('animationend', () => circle.remove(), { once: true })
    }

    parent.addEventListener('pointerdown', onPointerDown)
    return () => parent.removeEventListener('pointerdown', onPointerDown)
  }, [])

  return (
    <span
      ref={hostRef}
      aria-hidden="true"
      className={`pointer-events-none absolute inset-0 overflow-hidden rounded-[inherit] ${className ?? ''}`}
    />
  )
}
