"use client"

import { useEffect, useRef, type KeyboardEvent } from "react"
import { FileUp, Play, Plus, StickyNote } from "lucide-react"

import { cn } from "@/lib/utils"

export type CanvasMenuState = { nodeId?: string; x: number; y: number }

type MenuActionProps = {
  icon: typeof Plus
  label: string
  onClick: () => void
}

function MenuAction({ icon: Icon, label, onClick }: MenuActionProps) {
  return (
    <button
      type="button"
      role="menuitem"
      className={cn(
        "flex h-9 w-full items-center gap-2.5 rounded-md px-2.5 text-left text-[13px] outline-none transition-colors",
        "hover:bg-accent focus-visible:bg-accent focus-visible:ring-2 focus-visible:ring-ring/50",
        "text-muted-foreground hover:text-foreground",
      )}
      onClick={onClick}
    >
      <Icon className="size-3.5 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1 truncate">{label}</span>
    </button>
  )
}

type NodeContextMenuProps = {
  menu: CanvasMenuState
  onAddNode: () => void
  onAddNote: () => void
  onImportApp: () => void
  onTestRun: () => void
  wrapperElement: HTMLElement | null
}

export function NodeContextMenu({
  menu,
  onAddNode,
  onAddNote,
  onImportApp,
  onTestRun,
  wrapperElement,
}: NodeContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null)
  const bounds = wrapperElement?.getBoundingClientRect()
  const left = Math.max(8, Math.min(menu.x - (bounds?.left ?? 0), (bounds?.width ?? 1024) - 240))
  const top = Math.max(8, Math.min(menu.y - (bounds?.top ?? 0), (bounds?.height ?? 768) - 168))

  useEffect(() => {
    menuRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus()
  }, [])

  const moveFocus = (event: KeyboardEvent<HTMLDivElement>) => {
    const items = [...(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [])]
    if (!items.length) return
    const currentIndex = Math.max(0, items.indexOf(document.activeElement as HTMLButtonElement))
    let nextIndex: number | null = null
    if (event.key === "ArrowDown") nextIndex = (currentIndex + 1) % items.length
    if (event.key === "ArrowUp") nextIndex = (currentIndex - 1 + items.length) % items.length
    if (event.key === "Home") nextIndex = 0
    if (event.key === "End") nextIndex = items.length - 1
    if (nextIndex === null) return
    event.preventDefault()
    items[nextIndex]?.focus()
  }

  return (
    <div
      ref={menuRef}
      className="workflow-context-menu absolute z-50 w-56 rounded-lg border border-border bg-popover p-1 text-foreground shadow-xl"
      style={{ left, top }}
      onMouseDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
      onKeyDown={moveFocus}
      role="menu"
      aria-label="快捷操作"
    >
      <MenuAction icon={Plus} label="添加节点" onClick={onAddNode} />
      <MenuAction icon={StickyNote} label="添加注释" onClick={onAddNote} />
      <MenuAction icon={Play} label="测试运行" onClick={onTestRun} />
      <MenuAction icon={FileUp} label="导入应用" onClick={onImportApp} />
    </div>
  )
}
