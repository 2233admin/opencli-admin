"use client"

import type { ReactNode } from "react"
import { X } from "lucide-react"
import { cn } from "@/lib/utils"

const stateText: Record<string, string> = {
  idle: "Idle",
  running: "Running",
  success: "Done",
  error: "Error",
}

const stateDotClass: Record<string, string> = {
  idle: "border-muted-foreground/50 bg-transparent",
  running: "border-[#ff7a17] bg-[#ff7a17]",
  success: "border-[#4ade80] bg-[#4ade80]",
  error: "border-destructive bg-destructive",
}

function splitTypeLine(typeLine: string) {
  const [kind = typeLine, version = ""] = typeLine.split("·").map((part) => part.trim())
  return { kind, version }
}

export function SectionCaption({ children }: { children: ReactNode }) {
  return (
    <p className="font-mono text-[9px] uppercase tracking-[0.2em] text-muted-foreground/70">
      {children}
    </p>
  )
}

export function MonoRow({ k, v }: { k: string; v: string | number }) {
  return (
    <div className="flex items-center justify-between gap-2 font-mono text-[11px]">
      <span className="text-muted-foreground">{k}</span>
      <span className="truncate text-foreground">{v}</span>
    </div>
  )
}

function PanelStatus({ status }: { status?: string }) {
  if (!status) return null
  return (
    <span
      className="inline-flex shrink-0 items-center gap-1.5 text-muted-foreground"
      title={`Status: ${stateText[status] ?? status}`}
    >
      <span className={cn("size-1.5 rounded-full border", stateDotClass[status] ?? stateDotClass.idle)} />
      <span>{stateText[status] ?? status}</span>
    </span>
  )
}

export function PanelShell({
  title,
  typeLine,
  status,
  onClose,
  children,
}: {
  title: string
  typeLine: string
  status?: string
  onClose: () => void
  children: ReactNode
}) {
  const { kind, version } = splitTypeLine(typeLine)

  return (
    <aside
      data-health="inspector"
      className="absolute bottom-3 right-3 top-3 z-40 flex w-[min(380px,calc(100vw-1.5rem))] flex-col overflow-hidden rounded-[4px] border border-[#252a31] bg-[#08090b]/96 shadow-2xl backdrop-blur-sm duration-150 animate-in fade-in slide-in-from-right-4"
      aria-label="参数面板"
    >
      <div className="border-b border-[#20242a] bg-[#0d0f12] px-3 py-2">
        <div className="grid grid-cols-[96px_minmax(0,1fr)_auto_20px] items-center gap-2">
          <span className="flex h-7 min-w-0 items-center truncate rounded-[2px] border border-[#2a3038] bg-[#181b20] px-2 font-mono text-[9px] uppercase tracking-[0.08em] text-muted-foreground">
            {kind}
          </span>
          <div className="flex h-7 min-w-0 items-center rounded-[2px] border border-[#2a3038] bg-[#050607] px-2 shadow-inner">
            <h2 className="truncate font-mono text-[12px] font-semibold text-foreground">{title}</h2>
          </div>
          <PanelStatus status={status} />
          <button
            type="button"
            onClick={onClose}
            className="flex size-5 shrink-0 items-center justify-center rounded-[2px] text-muted-foreground transition-colors hover:bg-[#20242a] hover:text-foreground"
            aria-label="关闭参数面板"
          >
            <X className="size-3.5" />
          </button>
        </div>
        <div className="mt-1 flex h-4 items-center gap-2 pl-[104px] font-mono text-[9px] uppercase tracking-[0.18em] text-muted-foreground/70">
          <span>Parameter Interface</span>
          {version ? <span className="tracking-[0.08em]">{version}</span> : null}
        </div>
      </div>
      <div
        data-inspector-scroll
        className="workflow-inspector-scroll min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain"
      >
        {children}
      </div>
    </aside>
  )
}
