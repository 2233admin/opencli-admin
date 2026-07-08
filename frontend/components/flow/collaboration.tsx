"use client"

import { useEffect, useRef } from "react"
import { useReactFlow, useStore } from "@xyflow/react"
import { useFlowStore } from "@/lib/flow/store"
import { useSettingsStore } from "@/lib/flow/settings-store"
import { useYjs } from "@/lib/flow/yjs-provider"

export function Collaboration() {
  const provider = useSettingsStore((s) => s.collabProvider)
  const yjsUrl = useSettingsStore((s) => s.yjsUrl)
  const yjsRoom = useSettingsStore((s) => s.yjsRoom)
  const enabled = provider === "yjs"

  const binding = useYjs(enabled, { url: yjsUrl, room: yjsRoom })
  const { screenToFlowPosition } = useReactFlow()
  const transform = useStore((s) => s.transform)
  const applyingRemote = useRef(false)

  // outgoing: whenever local nodes/edges change, publish to yjs
  useEffect(() => {
    if (!enabled) return
    const unsub = useFlowStore.subscribe((state, prev) => {
      if (applyingRemote.current) return
      if (state.nodes === prev.nodes && state.edges === prev.edges) return
      binding.publish(state.nodes, state.edges)
    })
    // initial push
    const { nodes, edges } = useFlowStore.getState()
    binding.publish(nodes, edges)
    return unsub
  }, [enabled, binding])

  // incoming: apply remote to local store
  useEffect(() => {
    if (!enabled) return
    return binding.onRemote((nodes, edges) => {
      applyingRemote.current = true
      useFlowStore.setState({ nodes, edges })
      queueMicrotask(() => {
        applyingRemote.current = false
      })
    })
  }, [enabled, binding])

  // cursor broadcast
  useEffect(() => {
    if (!enabled) return
    let raf = 0
    const onMove = (e: MouseEvent) => {
      if (raf) return
      raf = requestAnimationFrame(() => {
        raf = 0
        const p = screenToFlowPosition({ x: e.clientX, y: e.clientY })
        binding.publishCursor(p.x, p.y)
      })
    }
    window.addEventListener("mousemove", onMove)
    return () => {
      window.removeEventListener("mousemove", onMove)
      if (raf) cancelAnimationFrame(raf)
    }
  }, [enabled, binding, screenToFlowPosition])

  if (!enabled) return null
  const [tx, ty, zoom] = transform

  return (
    <>
      <div className="pointer-events-none absolute inset-0 z-20 overflow-hidden">
        {binding.cursors.map((c) => (
          <div
            key={c.id}
            className="absolute flex items-center gap-1"
            style={{ transform: `translate(${tx + c.x * zoom}px, ${ty + c.y * zoom}px)` }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" style={{ color: c.color }}>
              <path fill="currentColor" d="M4 2l6 16 2.5-6.5L19 9z" />
            </svg>
            <span
              className="rounded px-1.5 py-0.5 text-[10px] font-medium text-white shadow"
              style={{ backgroundColor: c.color }}
            >
              {c.name}
            </span>
          </div>
        ))}
      </div>

      <div className="pointer-events-none absolute right-3 top-3 z-30 flex items-center gap-2 rounded-md border bg-card/90 px-2 py-1 font-mono text-[10px] shadow backdrop-blur">
        <span className={binding.connected ? "text-[#4ade80]" : "text-[#ff7a17]"}>
          {binding.connected ? "● LIVE" : "○ CONNECTING"}
        </span>
        <span className="text-muted-foreground">·</span>
        <span className="text-muted-foreground">room {yjsRoom}</span>
        {binding.users.length > 0 ? (
          <>
            <span className="text-muted-foreground">·</span>
            <div className="flex -space-x-1">
              {binding.users.slice(0, 6).map((u) => (
                <span
                  key={u.id}
                  className="flex size-4 items-center justify-center rounded-full border border-background text-[8px] font-semibold text-white"
                  style={{ backgroundColor: u.color }}
                  title={u.name}
                >
                  {u.name[0]?.toUpperCase()}
                </span>
              ))}
            </div>
          </>
        ) : null}
      </div>
    </>
  )
}
